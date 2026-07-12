/**
 * Shared Google-API-client mock for handler and patch tests.
 *
 * `call()` returns RAW Google JSON — there is no `{ success, data, stderr }`
 * envelope to build, so a mocked return value IS the fixture (ADR-103):
 *
 *   mockCall.mockResolvedValue(driveFileListResponse);
 *
 * and an assertion names the method, not a command line:
 *
 *   expect(mockCall).toHaveBeenCalledWith(
 *     'drive', 'files.list',
 *     expect.objectContaining({ q: "name contains 'report'" }),
 *     expect.objectContaining({ account: 'user@test.com' }),
 *   );
 */
import { vi, type MockedFunction } from 'vitest';

import { call, download, upload } from '../../../../google/client.js';

// Same contract as the executor helper: if the importing test forgot its
// vi.mock, `call` is the REAL client — it would reach the credential store and
// then Google. Fail at import instead of at the socket.
if (!vi.isMockFunction(call)) {
  throw new Error(
    'client mock helper: the Google API client is not mocked.\n' +
    'Add a vi.mock for the client to the TEST FILE that imports this helper — ' +
    'vitest hoists vi.mock per-file, so registering it here would only work by ' +
    'import-order luck.\n' +
    "The specifier is relative to YOUR test file, e.g. vi.mock('../../../google/client.js') " +
    "from src/__tests__/server/handlers/, or vi.mock('../../google/client.js') from " +
    'src/__tests__/factory/.',
  );
}

export const mockCall = call as MockedFunction<typeof call>;
export const mockDownload = download as MockedFunction<typeof download>;
export const mockUpload = upload as MockedFunction<typeof upload>;
