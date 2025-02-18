/**
 * Gmail's allowed label colors
 * These are the only colors that Gmail's API accepts for label customization
 */
export const GMAIL_LABEL_COLORS = {
  default: {
    textColor: '#000000',
    backgroundColor: '#ffffff'
  },
  red: {
    textColor: '#ffffff',
    backgroundColor: '#dc3545'
  },
  orange: {
    textColor: '#000000',
    backgroundColor: '#ffc107'
  },
  yellow: {
    textColor: '#000000',
    backgroundColor: '#ffeb3b'
  },
  green: {
    textColor: '#ffffff',
    backgroundColor: '#28a745'
  },
  teal: {
    textColor: '#ffffff',
    backgroundColor: '#20c997'
  },
  blue: {
    textColor: '#ffffff',
    backgroundColor: '#007bff'
  },
  purple: {
    textColor: '#ffffff',
    backgroundColor: '#6f42c1'
  },
  pink: {
    textColor: '#ffffff',
    backgroundColor: '#e83e8c'
  },
  gray: {
    textColor: '#ffffff',
    backgroundColor: '#6c757d'
  }
} as const;

export type GmailLabelColor = keyof typeof GMAIL_LABEL_COLORS;

/**
 * Validates if a color combination is allowed by Gmail
 * @param textColor - Hex color code for text
 * @param backgroundColor - Hex color code for background
 * @returns true if the color combination is valid, false otherwise
 */
export function isValidGmailLabelColor(textColor: string, backgroundColor: string): boolean {
  return Object.values(GMAIL_LABEL_COLORS).some(
    color => color.textColor.toLowerCase() === textColor.toLowerCase() &&
             color.backgroundColor.toLowerCase() === backgroundColor.toLowerCase()
  );
}

/**
 * Gets the closest valid Gmail label color based on a hex code
 * @param backgroundColor - Hex color code to match
 * @returns The closest matching valid Gmail label color combination
 */
export function getNearestGmailLabelColor(backgroundColor: string): typeof GMAIL_LABEL_COLORS[GmailLabelColor] {
  // Remove # if present and convert to lowercase
  const targetColor = backgroundColor.replace('#', '').toLowerCase();
  
  // Convert hex to RGB
  const targetRGB = {
    r: parseInt(targetColor.substr(0, 2), 16),
    g: parseInt(targetColor.substr(2, 2), 16),
    b: parseInt(targetColor.substr(4, 2), 16)
  };

  // Calculate distance to each valid color
  let closestColor = 'default' as GmailLabelColor;
  let minDistance = Number.MAX_VALUE;

  Object.entries(GMAIL_LABEL_COLORS).forEach(([name, color]) => {
    const validColor = color.backgroundColor.replace('#', '').toLowerCase();
    const validRGB = {
      r: parseInt(validColor.substr(0, 2), 16),
      g: parseInt(validColor.substr(2, 2), 16),
      b: parseInt(validColor.substr(4, 2), 16)
    };

    // Calculate Euclidean distance in RGB space
    const distance = Math.sqrt(
      Math.pow(validRGB.r - targetRGB.r, 2) +
      Math.pow(validRGB.g - targetRGB.g, 2) +
      Math.pow(validRGB.b - targetRGB.b, 2)
    );

    if (distance < minDistance) {
      minDistance = distance;
      closestColor = name as GmailLabelColor;
    }
  });

  return GMAIL_LABEL_COLORS[closestColor];
}

/**
 * Error messages for label operations
 */
export const LABEL_ERROR_MESSAGES = {
  INVALID_COLOR: 'Invalid label color. Please use one of the predefined Gmail label colors.',
  INVALID_COLOR_COMBINATION: 'Invalid text and background color combination.',
  COLOR_SUGGESTION: (original: string, suggested: typeof GMAIL_LABEL_COLORS[GmailLabelColor]) => 
    `The color "${original}" is not supported. Consider using the suggested color: Background: ${suggested.backgroundColor}, Text: ${suggested.textColor}`
} as const;
