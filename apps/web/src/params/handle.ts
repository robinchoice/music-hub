import type { ParamMatcher } from '@sveltejs/kit';
import { HANDLE_PATTERN } from '@music-hub/shared';

// Public profiles live at /@handle
export const match: ParamMatcher = (param) => param.startsWith('@') && HANDLE_PATTERN.test(param.slice(1));
