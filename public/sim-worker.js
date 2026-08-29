import { runSimulation } from './simulator.js';
import { runPlaySimulation } from './play-simulator.js';

self.onmessage = ({ data }) => {
  try {
    let result;
    if (data.mode === 'play') {
      result = runPlaySimulation(data.config, data.iterations, data.seed, (progress) => self.postMessage({ type: 'progress', progress }));
    } else if (data.mode === 'compare') {
      const drive = runSimulation(data.config, data.iterations, data.seed, (progress) => self.postMessage({ type: 'progress', progress: progress * 0.35 }));
      const play = runPlaySimulation(data.config, data.iterations, data.seed + 1, (progress) => self.postMessage({ type: 'progress', progress: 0.35 + progress * 0.65 }));
      result = { mode: 'compare', primary: play, drive, play };
    } else {
      result = runSimulation(data.config, data.iterations, data.seed, (progress) => self.postMessage({ type: 'progress', progress }));
      result.model = 'drive';
    }
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message || 'Simulation failed.' });
  }
};
