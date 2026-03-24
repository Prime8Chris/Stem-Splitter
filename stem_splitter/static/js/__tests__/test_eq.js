/**
 * Tests for eq.js — EQ spectrum visualization.
 */
const { setupTestEnv, createMockAnalyser } = require('./setup');

describe('eq.js', () => {
  let mockCtx;

  beforeEach(() => {
    const env = setupTestEnv(['app', 'eq']);
    mockCtx = env.mockCtx;
  });

  describe('drawEQ', () => {
    test('renders frequency bars to canvas', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-eq';
      document.body.appendChild(canvas);

      const analyser = createMockAnalyser();
      drawEQ('test-eq', analyser, '#ff0000');

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(analyser.getByteFrequencyData).toHaveBeenCalled();
      // Should draw 8 frequency bands
      expect(mockCtx.fillRect).toHaveBeenCalledTimes(8);
      // Should create gradients for each band
      expect(mockCtx.createLinearGradient).toHaveBeenCalledTimes(8);
    });

    test('handles missing canvas gracefully', () => {
      mockCtx.clearRect.mockClear();
      drawEQ('nonexistent', createMockAnalyser(), '#ff0000');
      expect(mockCtx.clearRect).not.toHaveBeenCalled();
    });

    test('handles null analyser gracefully', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-eq-null';
      document.body.appendChild(canvas);

      mockCtx.clearRect.mockClear();
      drawEQ('test-eq-null', null, '#ff0000');
      expect(mockCtx.clearRect).not.toHaveBeenCalled();
    });

    test('handles both null canvas and null analyser', () => {
      mockCtx.clearRect.mockClear();
      drawEQ('nonexistent', null, '#ff0000');
      expect(mockCtx.clearRect).not.toHaveBeenCalled();
    });

    test('reads frequency data from analyser', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-eq-data';
      document.body.appendChild(canvas);

      const analyser = createMockAnalyser();
      analyser.frequencyBinCount = 128;
      drawEQ('test-eq-data', analyser, '#00ff00');
      expect(analyser.getByteFrequencyData).toHaveBeenCalledWith(expect.any(Uint8Array));
    });

    test('uses correct color for gradient', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-eq-color';
      document.body.appendChild(canvas);

      const analyser = createMockAnalyser();
      drawEQ('test-eq-color', analyser, '#abcdef');

      // Verify gradient was created (we can't easily verify the color in the mock,
      // but we can verify the gradient stop was called)
      const gradient = mockCtx.createLinearGradient.mock.results[0].value;
      expect(gradient.addColorStop).toHaveBeenCalledTimes(2);
    });

    test('handles zero frequency data without error', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-eq-zero';
      document.body.appendChild(canvas);

      const analyser = createMockAnalyser();
      // Override to fill with zeros
      analyser.getByteFrequencyData = jest.fn((arr) => {
        for (let i = 0; i < arr.length; i++) arr[i] = 0;
      });

      expect(() => drawEQ('test-eq-zero', analyser, '#ff0000')).not.toThrow();
      // Should still draw bars (min height 1)
      expect(mockCtx.fillRect).toHaveBeenCalledTimes(8);
    });
  });
});
