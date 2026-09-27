import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom has no canvas; the renderer degrades gracefully when getContext is null.
HTMLCanvasElement.prototype.getContext = () => null;
