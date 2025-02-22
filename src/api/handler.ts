import { GoogleApiRequestParams, GoogleApiResponse, GoogleApiError } from '../types.js';
import { GoogleApiRequest } from './request.js';
import { EndpointValidator } from './validators/endpoint.js';
import { ParameterValidator } from './validators/parameter.js';
import { AttachmentResponseTransformer } from '../modules/attachments/response-transformer.js';
import { AttachmentIndexService } from '../modules/attachments/index-service.js';

export class RequestHandler {
  private endpointValidator: EndpointValidator;
  private parameterValidator: ParameterValidator;
  private attachmentTransformer: AttachmentResponseTransformer;

  constructor(
    private apiRequest: GoogleApiRequest,
    attachmentIndexService: AttachmentIndexService = AttachmentIndexService.getInstance()
  ) {
    this.endpointValidator = new EndpointValidator();
    this.parameterValidator = new ParameterValidator();
    this.attachmentTransformer = new AttachmentResponseTransformer(attachmentIndexService);
  }

  async handleRequest(params: GoogleApiRequestParams, token: string): Promise<GoogleApiResponse> {
    try {
      // Step 1: Basic validation
      await this.validateRequest(params);

      // Step 2: Execute request
      const result = await this.executeRequest(params, token);

      // Step 3: Format response
      return this.formatSuccessResponse(result);
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }

  private async validateRequest(params: GoogleApiRequestParams): Promise<void> {
    // Validate endpoint format and availability
    await this.endpointValidator.validate(params.api_endpoint);

    // Validate required parameters
    await this.parameterValidator.validate(params);
  }

  private async executeRequest(params: GoogleApiRequestParams, token: string): Promise<any> {
    return this.apiRequest.makeRequest({
      endpoint: params.api_endpoint,
      method: params.method,
      params: params.params,
      token
    });
  }

  private formatSuccessResponse(data: any): GoogleApiResponse {
    // Transform response to simplify attachments for AI
    const transformedData = this.attachmentTransformer.transformResponse(data);
    
    return {
      status: 'success',
      data: transformedData
    };
  }

  private formatErrorResponse(error: unknown): GoogleApiResponse {
    if (error instanceof GoogleApiError) {
      return {
        status: 'error',
        error: error.message,
        resolution: error.resolution
      };
    }

    // Handle unexpected errors
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      resolution: 'Please try again or contact support if the issue persists'
    };
  }
}
