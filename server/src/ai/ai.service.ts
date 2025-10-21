import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenAI | null;

  constructor(private readonly config: ConfigService) {
    const apiKey =
      this.config.get<string>('GOOGLE_GEMINI_API_KEY') ??
      this.config.get<string>('VITE_GOOGLE_GEMINI_API_KEY');

    if (!apiKey) {
      this.logger.warn('Google Gemini API key not configured. AI routes will be unavailable.');
      this.genAI = null;
      return;
    }

    this.genAI = new GoogleGenAI({ apiKey });
    this.logger.log('Google GenAI client initialised for server-side use.');
  }

  private ensureClient(): GoogleGenAI {
    if (!this.genAI) {
      throw new ServiceUnavailableException('Google Gemini API key not configured on the server.');
    }
    return this.genAI;
  }

  async runToolSelectionPrompt(prompt: string): Promise<{ text: string }> {
    if (!prompt || !prompt.trim()) {
      throw new BadRequestException('Tool selection prompt is empty.');
    }

    const client = this.ensureClient();
    const maxAttempts = 3;
    const delayMs = 1000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ text: prompt }],
          config: {
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          },
        });

        if (!response.text) {
          this.logger.warn('Tool selection response did not contain text. Full response omitted.');
          throw new Error('Empty Gemini response');
        }

        return { text: response.text };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Tool selection attempt ${attempt}/${maxAttempts} failed: ${message}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Unknown error occurred during tool selection.';
    this.logger.error(`All tool selection attempts failed: ${message}`);
    throw new ServiceUnavailableException('Failed to generate tool selection from Gemini.');
  }
}
