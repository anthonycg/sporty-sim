import { runSimulation } from './simulator.js';

self.onmessage = ({ data }) => {
  try {
    const result = runSimulation(data.config, data.iterations, data.seed, (progress) => {
      self.postMessage({ type: 'progress', progress });
    });
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message || 'Simulation failed.' });
  }
};
