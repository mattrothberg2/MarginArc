// Pure Node.js logistic regression with mini-batch SGD and L2 regularization.
// No external ML libraries — keeps Lambda deployment lean.

// --- Internal helpers (not exported) ---

function clip(z, lo, hi) {
  return z < lo ? lo : z > hi ? hi : z;
}

function sigmoid(z) {
  const zc = clip(z, -500, 500);
  return 1 / (1 + Math.exp(-zc));
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function logLoss(y, p) {
  const pc = clip(p, 1e-15, 1 - 1e-15);
  return -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
}

// Fisher-Yates shuffle with optional seeded PRNG (simple LCG).
function shuffle(arr, seed) {
  const result = arr.slice();
  let rng;
  if (seed != null) {
    // Linear congruential generator
    let s = seed;
    rng = () => {
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  } else {
    rng = Math.random;
  }
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

// --- Exported functions ---

/**
 * Train a logistic regression model via mini-batch SGD with L2 regularization.
 */
export function train(X, y, options = {}) {
  // Validate inputs
  if (!Array.isArray(X) || !Array.isArray(y)) {
    throw new Error('X and y must be arrays');
  }
  if (X.length !== y.length) {
    throw new Error(`X.length (${X.length}) !== y.length (${y.length})`);
  }
  if (X.length === 0) {
    throw new Error('X must not be empty');
  }
  if (!X[0] || X[0].length === 0) {
    throw new Error('Feature vectors must have at least one feature');
  }
  for (let i = 0; i < y.length; i++) {
    if (y[i] !== 0 && y[i] !== 1) {
      throw new Error(`y[${i}] = ${y[i]}, expected 0 or 1`);
    }
  }

  const {
    learningRate = 0.01,
    lambda = 0.01,
    epochs = 500,
    batchSize = 32,
    validationSplit = 0.2,
    earlyStoppingPatience = 20,
    seed = null,
    sampleWeights = null,
  } = options;

  // Validate sampleWeights if provided
  if (sampleWeights != null) {
    if (!Array.isArray(sampleWeights)) {
      throw new Error('sampleWeights must be an array');
    }
    if (sampleWeights.length !== X.length) {
      throw new Error(
        `sampleWeights.length (${sampleWeights.length}) !== X.length (${X.length})`
      );
    }
    for (let i = 0; i < sampleWeights.length; i++) {
      if (typeof sampleWeights[i] !== 'number' || sampleWeights[i] < 0) {
        throw new Error(`sampleWeights[${i}] = ${sampleWeights[i]}, expected non-negative number`);
      }
    }
  }

  const nFeatures = X[0].length;

  // Build index array and shuffle
  let indices = Array.from({ length: X.length }, (_, i) => i);
  indices = shuffle(indices, seed != null ? seed : undefined);

  // Split into train / validation
  const valSize = Math.max(1, Math.floor(indices.length * validationSplit));
  const trainSize = indices.length - valSize;
  const trainIdx = indices.slice(0, trainSize);
  const valIdx = indices.slice(trainSize);

  // Initialize weights and bias
  let weights = new Array(nFeatures).fill(0);
  let bias = 0;

  // Early stopping state
  let bestValLoss = Infinity;
  let bestWeights = weights.slice();
  let bestBias = bias;
  let patienceCounter = 0;
  let epochsRun = 0;

  // Helper to compute weighted mean log loss over a set of indices
  function computeLoss(idxArr) {
    let total = 0;
    let wSum = 0;
    for (const idx of idxArr) {
      const z = dot(weights, X[idx]) + bias;
      const p = sigmoid(z);
      const w_i = sampleWeights ? sampleWeights[idx] : 1;
      total += logLoss(y[idx], p) * w_i;
      wSum += w_i;
    }
    return total / wSum;
  }

  // Use seed + offset for per-epoch shuffles so they differ from initial shuffle
  let epochSeed = seed != null ? seed + 1000 : undefined;

  for (let epoch = 0; epoch < epochs; epoch++) {
    epochsRun = epoch + 1;

    // Shuffle training indices each epoch
    const shuffledTrain = shuffle(trainIdx, epochSeed);
    if (epochSeed != null) epochSeed++;

    // Process mini-batches
    for (let start = 0; start < shuffledTrain.length; start += batchSize) {
      const end = Math.min(start + batchSize, shuffledTrain.length);
      const batchLen = end - start;

      // Accumulate gradients
      const gradW = new Array(nFeatures).fill(0);
      let gradB = 0;
      let weightSum = 0;

      for (let b = start; b < end; b++) {
        const idx = shuffledTrain[b];
        const xi = X[idx];
        const yi = y[idx];
        const w_i = sampleWeights ? sampleWeights[idx] : 1;
        const z = dot(weights, xi) + bias;
        const pred = sigmoid(z);
        const err = (pred - yi) * w_i;

        for (let f = 0; f < nFeatures; f++) {
          gradW[f] += err * xi[f];
        }
        gradB += err;
        weightSum += w_i;
      }

      // Average gradients (by weight sum if weighted) + L2 regularization
      const divisor = sampleWeights ? weightSum : batchLen;
      for (let f = 0; f < nFeatures; f++) {
        gradW[f] = gradW[f] / divisor + lambda * weights[f];
        weights[f] -= learningRate * gradW[f];
      }
      bias -= learningRate * (gradB / divisor);
    }

    // Compute losses
    const tLoss = computeLoss(trainIdx);
    const vLoss = computeLoss(valIdx);

    // Early stopping check
    if (vLoss < bestValLoss) {
      bestValLoss = vLoss;
      bestWeights = weights.slice();
      bestBias = bias;
      patienceCounter = 0;
    } else {
      patienceCounter++;
      if (patienceCounter >= earlyStoppingPatience) {
        // Restore best weights
        weights = bestWeights;
        bias = bestBias;
        break;
      }
    }
  }

  const trainLoss = computeLoss(trainIdx);
  const valLoss = computeLoss(valIdx);

  return {
    weights,
    bias,
    featureCount: nFeatures,
    epochsRun,
    trainLoss,
    valLoss,
    trainedAt: new Date().toISOString(),
  };
}

/**
 * Predict win probability for a single sample.
 */
export function predict(model, features) {
  if (features.length !== model.featureCount) {
    throw new Error(
      `Feature length mismatch: expected ${model.featureCount}, got ${features.length}`
    );
  }
  const z = dot(model.weights, features) + model.bias;
  return sigmoid(z);
}

/**
 * Predict win probability for multiple samples.
 */
export function predictBatch(model, X) {
  return X.map((row) => predict(model, row));
}

/**
 * Comprehensive model evaluation.
 * Returns { auc, logLoss, accuracy, calibration, n }.
 */
export function evaluate(model, X, y) {
  const n = X.length;
  const preds = predictBatch(model, X);

  // Log loss
  let totalLogLoss = 0;
  for (let i = 0; i < n; i++) {
    totalLogLoss += logLoss(y[i], preds[i]);
  }
  const meanLogLoss = totalLogLoss / n;

  // Accuracy at 0.5 threshold
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const predicted = preds[i] >= 0.5 ? 1 : 0;
    if (predicted === y[i]) correct++;
  }
  const accuracy = correct / n;

  // AUC via trapezoidal rule on the ROC curve
  const auc = computeAUC(preds, y);

  // Calibration: 10 equal-width bins
  const calibration = computeCalibration(preds, y);

  return { auc, logLoss: meanLogLoss, accuracy, calibration, n };
}

function computeAUC(preds, y) {
  const n = preds.length;

  // Count positives and negatives
  let nPos = 0;
  let nNeg = 0;
  for (let i = 0; i < n; i++) {
    if (y[i] === 1) nPos++;
    else nNeg++;
  }
  if (nPos === 0 || nNeg === 0) return 0.5;

  // Sort by prediction descending
  const items = preds.map((p, i) => ({ pred: p, label: y[i] }));
  items.sort((a, b) => b.pred - a.pred);

  // Walk through sorted list, building ROC curve
  let tp = 0;
  let fp = 0;
  let prevTPR = 0;
  let prevFPR = 0;
  let auc = 0;

  for (let i = 0; i < items.length; i++) {
    if (items[i].label === 1) {
      tp++;
    } else {
      fp++;
    }
    const tpr = tp / nPos;
    const fpr = fp / nNeg;
    // Trapezoidal integration
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
    prevTPR = tpr;
    prevFPR = fpr;
  }

  return auc;
}

function computeCalibration(preds, y) {
  const bins = [];
  for (let b = 0; b < 10; b++) {
    const lo = b / 10;
    const hi = (b + 1) / 10;
    const label = `${lo.toFixed(1)}-${hi.toFixed(1)}`;
    let sumPred = 0;
    let sumLabel = 0;
    let count = 0;
    for (let i = 0; i < preds.length; i++) {
      // Last bin is inclusive on upper bound
      const inBin = b < 9
        ? preds[i] >= lo && preds[i] < hi
        : preds[i] >= lo && preds[i] <= hi;
      if (inBin) {
        sumPred += preds[i];
        sumLabel += y[i];
        count++;
      }
    }
    if (count > 0) {
      bins.push({
        bucket: label,
        predicted: sumPred / count,
        actual: sumLabel / count,
        count,
      });
    }
  }
  return bins;
}

/**
 * Feature importance ranking sorted by |weight| descending.
 */
export function getFeatureImportance(model, featureNames) {
  if (featureNames.length !== model.weights.length) {
    throw new Error(
      `featureNames length (${featureNames.length}) !== model weights length (${model.weights.length})`
    );
  }
  return featureNames
    .map((name, i) => ({
      name,
      weight: model.weights[i],
      absWeight: Math.abs(model.weights[i]),
      direction: model.weights[i] >= 0 ? 'positive' : 'negative',
    }))
    .sort((a, b) => b.absWeight - a.absWeight);
}

/**
 * Serialize model to JSON string.
 */
export function serializeModel(model) {
  return JSON.stringify(model);
}

/**
 * Deserialize model from JSON string.
 */
export function deserializeModel(json) {
  const obj = JSON.parse(json);
  const required = ['weights', 'bias', 'featureCount'];
  for (const key of required) {
    if (!(key in obj)) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  return obj;
}
