import { type RenderUIInput, type ValidationResult } from './protocol.js';
export declare function validateRenderUiInput(input: unknown): ValidationResult;
export declare function assertRenderUiInput(input: unknown): RenderUIInput;
export declare function normalizeRenderUiInput(input: unknown): RenderUIInput;
export declare function validateA2uiMessages(messages: unknown): ValidationResult;
