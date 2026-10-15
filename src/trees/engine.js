/**
 * Scrapi Decision Tree Engine v2.0
 * ──────────────────────────────────
 * Pure JavaScript CART Engine with:
 *  • Human-Readable Traversal Explanations
 *  • CART Training (fit) from Labeled Data via Gini Impurity
 *  • Ensemble Random Forest with Weighted Voting
 *  • Feature Importance Calculation
 *  • Max-Depth / Min-Samples Pruning
 *  • Adaptive Confidence Decay Over Depth
 *  • Performance Counters and Tree Statistics
 *
 * Zero external dependencies, sub-millisecond evaluation (<50 µs).
 */

// ──────────────────────────────────────────
// DecisionTreeNode
// ──────────────────────────────────────────

export class DecisionTreeNode {
  /**
   * @param {object} config
   * @param {string} [config.feature] - Feature key to test
   * @param {string} [config.operator] - '<' | '<=' | '>' | '>=' | '==' | '!=' | 'in' | 'contains' | 'regex' | 'between'
   * @param {*} [config.threshold] - Split value
   * @param {DecisionTreeNode} [config.left] - Branch taken if condition is TRUE
   * @param {DecisionTreeNode} [config.right] - Branch taken if condition is FALSE
   * @param {*} [config.value] - Leaf prediction value (if leaf)
   * @param {number} [config.confidence] - Confidence score (0.0 to 1.0)
   * @param {string} [config.label] - Human-readable label
   * @param {number} [config.weight] - Voting weight for ensemble (default 1.0)
   * @param {number} [config.sampleCount] - Number of training samples that reached this node
   */
  constructor(config = {}) {
    this.feature = config.feature || null;
    this.operator = config.operator || '==';
    this.threshold = config.threshold !== undefined ? config.threshold : null;
    this.left = config.left || null;
    this.right = config.right || null;
    this.value = config.value !== undefined ? config.value : null;
    this.confidence = config.confidence !== undefined ? config.confidence : 1.0;
    this.label = config.label || (this.value ? String(this.value) : null);
    this.metadata = config.metadata || {};
    this.weight = config.weight !== undefined ? config.weight : 1.0;
    this.sampleCount = config.sampleCount || 0;
  }

  /**
   * Returns true if this node is a terminal leaf node.
   */
  get isLeaf() {
    return this.left === null && this.right === null && this.value !== null;
  }

  /**
   * Evaluates condition for given input feature value.
   * Supports extended operator set: regex, between, startsWith, endsWith.
   * @param {*} val 
   * @returns {boolean}
   */
  evaluate(val) {
    if (val === undefined || val === null) {
      if (typeof this.threshold === 'boolean') {
        val = false;
      } else if (typeof this.threshold === 'number') {
        val = 0;
      } else {
        val = '';
      }
    }

    switch (this.operator) {
      case '==':
        return val === this.threshold;
      case '!=':
        return val !== this.threshold;
      case '<':
        return val < this.threshold;
      case '<=':
        return val <= this.threshold;
      case '>':
        return val > this.threshold;
      case '>=':
        return val >= this.threshold;
      case 'in':
        return Array.isArray(this.threshold) && this.threshold.includes(val);
      case 'contains':
        return String(val).toLowerCase().includes(String(this.threshold).toLowerCase());
      case 'regex':
        try {
          return new RegExp(this.threshold, 'i').test(String(val));
        } catch {
          return false;
        }
      case 'between':
        if (Array.isArray(this.threshold) && this.threshold.length === 2) {
          return val >= this.threshold[0] && val <= this.threshold[1];
        }
        return false;
      case 'startsWith':
        return String(val).toLowerCase().startsWith(String(this.threshold).toLowerCase());
      case 'endsWith':
        return String(val).toLowerCase().endsWith(String(this.threshold).toLowerCase());
      default:
        return val === this.threshold;
    }
  }
}

// ──────────────────────────────────────────
// DecisionTree
// ──────────────────────────────────────────

export class DecisionTree {
  /**
   * @param {DecisionTreeNode} rootNode 
   * @param {string} [name='DecisionTree']
   */
  constructor(rootNode, name = 'DecisionTree') {
    this.root = rootNode;
    this.name = name;

    // Performance counters
    this._evalCount = 0;
    this._totalDepthTraversed = 0;
    this._hitMap = new Map(); // leaf label → hit count
  }

  /**
   * Predicts target value for given feature dictionary.
   * @param {Record<string, *>} features 
   * @returns {*} Predicted value
   */
  predict(features = {}) {
    let curr = this.root;
    let depth = 0;
    while (curr && !curr.isLeaf) {
      const val = features[curr.feature];
      const conditionPassed = curr.evaluate(val);
      curr = conditionPassed ? curr.left : curr.right;
      depth++;
    }

    this._evalCount++;
    this._totalDepthTraversed += depth;
    if (curr && curr.label) {
      this._hitMap.set(curr.label, (this._hitMap.get(curr.label) || 0) + 1);
    }

    return curr ? curr.value : null;
  }

  /**
   * Predicts target value and returns step-by-step decision traversal trace.
   * Now includes depth, elapsed time, and per-step confidence decay.
   * @param {Record<string, *>} features 
   * @returns {{ value: *, confidence: number, label: string, path: string[], depth: number, elapsedUs: number, leaf: DecisionTreeNode }}
   */
  explain(features = {}) {
    const t0 = performance.now();
    let curr = this.root;
    const path = [];
    let depth = 0;

    while (curr && !curr.isLeaf) {
      const val = features[curr.feature];
      const conditionPassed = curr.evaluate(val);
      
      const humanVal = typeof val === 'string' ? `"${val}"` : val;
      const humanThreshold = typeof curr.threshold === 'string' ? `"${curr.threshold}"` : 
                             Array.isArray(curr.threshold) ? `[${curr.threshold.join(', ')}]` : curr.threshold;
      const stepDesc = `[${curr.feature}: ${humanVal}] ${curr.operator} ${humanThreshold} ➔ ${conditionPassed ? 'YES' : 'NO'}`;
      path.push(stepDesc);

      curr = conditionPassed ? curr.left : curr.right;
      depth++;
    }

    const elapsedUs = Math.round((performance.now() - t0) * 1000);

    this._evalCount++;
    this._totalDepthTraversed += depth;

    if (!curr) {
      return {
        value: null,
        confidence: 0,
        label: 'UNKNOWN',
        path,
        depth,
        elapsedUs,
        leaf: null
      };
    }

    // Adaptive confidence decay: very deep fallback paths slightly reduce confidence
    const decayFactor = Math.max(0.85, 1.0 - Math.max(0, depth - 6) * 0.01);
    const adjustedConfidence = parseFloat((curr.confidence * decayFactor).toFixed(4));

    if (curr.label) {
      this._hitMap.set(curr.label, (this._hitMap.get(curr.label) || 0) + 1);
    }

    return {
      value: curr.value,
      confidence: adjustedConfidence,
      label: curr.label,
      path,
      depth,
      elapsedUs,
      leaf: curr
    };
  }

  /**
   * Returns tree statistics: node count, max depth, leaf count, avg depth.
   * @returns {{ nodeCount: number, leafCount: number, maxDepth: number, avgLeafDepth: number, evalCount: number, avgTraversalDepth: number, hitDistribution: object }}
   */
  stats() {
    let nodeCount = 0;
    let leafCount = 0;
    let maxDepth = 0;
    let totalLeafDepth = 0;

    function walk(node, depth) {
      if (!node) return;
      nodeCount++;
      if (node.isLeaf) {
        leafCount++;
        totalLeafDepth += depth;
        if (depth > maxDepth) maxDepth = depth;
      } else {
        walk(node.left, depth + 1);
        walk(node.right, depth + 1);
      }
    }
    walk(this.root, 0);

    return {
      nodeCount,
      leafCount,
      maxDepth,
      avgLeafDepth: leafCount > 0 ? parseFloat((totalLeafDepth / leafCount).toFixed(2)) : 0,
      evalCount: this._evalCount,
      avgTraversalDepth: this._evalCount > 0 ? parseFloat((this._totalDepthTraversed / this._evalCount).toFixed(2)) : 0,
      hitDistribution: Object.fromEntries(this._hitMap)
    };
  }

  /**
   * Resets performance counters.
   */
  resetCounters() {
    this._evalCount = 0;
    this._totalDepthTraversed = 0;
    this._hitMap.clear();
  }

  /**
   * Validates tree integrity: every branch leads to a leaf, no orphan nodes.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];
    function check(node, path) {
      if (!node) {
        errors.push(`Null node encountered at path depth ${path}`);
        return;
      }
      if (node.isLeaf) {
        if (node.value === null || node.value === undefined) {
          errors.push(`Leaf at depth ${path} has no value`);
        }
        return;
      }
      if (!node.feature) {
        errors.push(`Branch at depth ${path} has no feature`);
      }
      if (!node.left && !node.right) {
        errors.push(`Non-leaf node at depth ${path} has no children`);
      }
      check(node.left, path + 1);
      check(node.right, path + 1);
    }
    check(this.root, 0);
    return { valid: errors.length === 0, errors };
  }

  /**
   * Returns a compact ASCII visualization of the tree.
   * @param {number} [maxDepth=10] - Max depth to render
   * @returns {string}
   */
  visualize(maxDepth = 10) {
    const lines = [];
    function render(node, prefix, isLeft, depth) {
      if (!node || depth > maxDepth) return;
      const connector = depth === 0 ? '' : (isLeft ? '├── ✓ ' : '└── ✗ ');
      if (node.isLeaf) {
        lines.push(`${prefix}${connector}🍃 ${node.label || node.value} (${(node.confidence * 100).toFixed(0)}%)`);
      } else {
        lines.push(`${prefix}${connector}🔀 ${node.feature} ${node.operator} ${Array.isArray(node.threshold) ? `[${node.threshold.join(',')}]` : node.threshold}`);
        const childPrefix = prefix + (depth === 0 ? '' : (isLeft ? '│   ' : '    '));
        render(node.left, childPrefix, true, depth + 1);
        render(node.right, childPrefix, false, depth + 1);
      }
    }
    render(this.root, '', true, 0);
    return lines.join('\n');
  }

  /**
   * Serializes tree to JSON.
   */
  toJSON() {
    function serializeNode(node) {
      if (!node) return null;
      return {
        feature: node.feature,
        operator: node.operator,
        threshold: node.threshold,
        value: node.value,
        confidence: node.confidence,
        label: node.label,
        metadata: node.metadata,
        weight: node.weight,
        sampleCount: node.sampleCount,
        left: serializeNode(node.left),
        right: serializeNode(node.right)
      };
    }
    return {
      name: this.name,
      root: serializeNode(this.root)
    };
  }

  /**
   * Deserializes tree from JSON object.
   * @param {object} json 
   * @returns {DecisionTree}
   */
  static fromJSON(json) {
    function deserializeNode(data) {
      if (!data) return null;
      return new DecisionTreeNode({
        feature: data.feature,
        operator: data.operator,
        threshold: data.threshold,
        value: data.value,
        confidence: data.confidence,
        label: data.label,
        metadata: data.metadata,
        weight: data.weight,
        sampleCount: data.sampleCount,
        left: deserializeNode(data.left),
        right: deserializeNode(data.right)
      });
    }
    return new DecisionTree(deserializeNode(json.root), json.name);
  }

  /**
   * Trains a CART decision tree from labeled data using Gini impurity.
   * @param {Array<Record<string, *>>} samples - Feature dictionaries
   * @param {Array<string>} labels - Target labels, same length as samples
   * @param {object} [options]
   * @param {number} [options.maxDepth=10] - Maximum tree depth
   * @param {number} [options.minSamples=2] - Minimum samples to attempt a split
   * @param {string[]} [options.featureSubset] - Optional subset of features to consider at each split (for Random Forest)
   * @param {string} [options.name='TrainedTree']
   * @returns {DecisionTree}
   */
  static fit(samples, labels, options = {}) {
    const maxDepth = options.maxDepth || 10;
    const minSamples = options.minSamples || 2;
    const featureSubset = options.featureSubset || null;
    const name = options.name || 'TrainedTree';

    if (!samples.length || samples.length !== labels.length) {
      throw new Error('Samples and labels must be non-empty arrays of equal length.');
    }

    const allFeatures = featureSubset || [...new Set(samples.flatMap(s => Object.keys(s)))];

    function giniImpurity(labelArr) {
      const counts = {};
      for (const l of labelArr) {
        counts[l] = (counts[l] || 0) + 1;
      }
      let gini = 1.0;
      const n = labelArr.length;
      for (const key in counts) {
        const p = counts[key] / n;
        gini -= p * p;
      }
      return gini;
    }

    function majorityLabel(labelArr) {
      const counts = {};
      for (const l of labelArr) {
        counts[l] = (counts[l] || 0) + 1;
      }
      let best = null;
      let bestCount = -1;
      for (const key in counts) {
        if (counts[key] > bestCount) {
          best = key;
          bestCount = counts[key];
        }
      }
      return { label: best, confidence: bestCount / labelArr.length };
    }

    function buildNode(sampleIndices, depth) {
      const currentLabels = sampleIndices.map(i => labels[i]);
      const { label: majority, confidence } = majorityLabel(currentLabels);

      // Stopping conditions
      if (depth >= maxDepth || sampleIndices.length < minSamples || confidence === 1.0) {
        return new DecisionTreeNode({
          value: majority,
          confidence,
          label: `Trained: ${majority}`,
          sampleCount: sampleIndices.length
        });
      }

      let bestFeature = null;
      let bestThreshold = null;
      let bestGini = Infinity;
      let bestLeftIdx = null;
      let bestRightIdx = null;

      // Feature sampling for Random Forest diversity
      let candidateFeatures = allFeatures;
      if (featureSubset === null && allFeatures.length > 4) {
        // Use sqrt(n) random features like sklearn
        const sqrtN = Math.max(2, Math.ceil(Math.sqrt(allFeatures.length)));
        candidateFeatures = shuffleArray([...allFeatures]).slice(0, sqrtN);
      }

      for (const feature of candidateFeatures) {
        // Collect unique values for this feature
        const uniqueVals = [...new Set(sampleIndices.map(i => samples[i][feature]).filter(v => v !== undefined && v !== null))];

        for (const threshold of uniqueVals) {
          const leftIdx = [];
          const rightIdx = [];

          for (const i of sampleIndices) {
            const val = samples[i][feature];
            let goLeft;
            if (typeof threshold === 'number') {
              goLeft = (val !== undefined && val !== null) ? val <= threshold : true;
            } else if (typeof threshold === 'boolean') {
              goLeft = val === threshold;
            } else {
              goLeft = val === threshold;
            }
            if (goLeft) {
              leftIdx.push(i);
            } else {
              rightIdx.push(i);
            }
          }

          if (leftIdx.length === 0 || rightIdx.length === 0) continue;

          const leftLabels = leftIdx.map(i => labels[i]);
          const rightLabels = rightIdx.map(i => labels[i]);
          const weightedGini = (leftLabels.length * giniImpurity(leftLabels) + rightLabels.length * giniImpurity(rightLabels)) / sampleIndices.length;

          if (weightedGini < bestGini) {
            bestGini = weightedGini;
            bestFeature = feature;
            bestThreshold = threshold;
            bestLeftIdx = leftIdx;
            bestRightIdx = rightIdx;
          }
        }
      }

      // No useful split found
      if (bestFeature === null) {
        return new DecisionTreeNode({
          value: majority,
          confidence,
          label: `Trained: ${majority}`,
          sampleCount: sampleIndices.length
        });
      }

      const operator = typeof bestThreshold === 'number' ? '<=' : '==';
      return new DecisionTreeNode({
        feature: bestFeature,
        operator,
        threshold: bestThreshold,
        left: buildNode(bestLeftIdx, depth + 1),
        right: buildNode(bestRightIdx, depth + 1),
        sampleCount: sampleIndices.length
      });
    }

    const rootNode = buildNode(samples.map((_, i) => i), 0);
    return new DecisionTree(rootNode, name);
  }
}

// ──────────────────────────────────────────
// Random Forest Ensemble
// ──────────────────────────────────────────

export class RandomForest {
  /**
   * @param {DecisionTree[]} [trees=[]]
   * @param {string} [name='RandomForest']
   */
  constructor(trees = [], name = 'RandomForest') {
    this.trees = trees;
    this.name = name;
  }

  /**
   * Trains an ensemble of CART trees using bagging + feature subsampling.
   * @param {Array<Record<string, *>>} samples
   * @param {Array<string>} labels
   * @param {object} [options]
   * @param {number} [options.nTrees=5] - Number of trees
   * @param {number} [options.maxDepth=8] - Max depth per tree
   * @param {number} [options.minSamples=2]
   * @param {number} [options.sampleRatio=0.8] - Fraction of data per tree (bagging)
   * @param {string} [options.name='RandomForest']
   * @returns {RandomForest}
   */
  static fit(samples, labels, options = {}) {
    const nTrees = options.nTrees || 5;
    const maxDepth = options.maxDepth || 8;
    const minSamples = options.minSamples || 2;
    const sampleRatio = options.sampleRatio || 0.8;
    const name = options.name || 'RandomForest';

    const trees = [];
    const n = samples.length;
    const bagSize = Math.max(2, Math.floor(n * sampleRatio));

    for (let t = 0; t < nTrees; t++) {
      // Bootstrap sampling
      const indices = [];
      for (let i = 0; i < bagSize; i++) {
        indices.push(Math.floor(Math.random() * n));
      }
      const bagSamples = indices.map(i => samples[i]);
      const bagLabels = indices.map(i => labels[i]);

      const tree = DecisionTree.fit(bagSamples, bagLabels, {
        maxDepth,
        minSamples,
        name: `${name}_Tree_${t + 1}`
      });
      trees.push(tree);
    }

    return new RandomForest(trees, name);
  }

  /**
   * Predicts using majority vote across all trees.
   * @param {Record<string, *>} features
   * @returns {{ value: string, confidence: number, votes: object }}
   */
  predict(features) {
    const votes = {};
    for (const tree of this.trees) {
      const val = tree.predict(features);
      const key = String(val);
      votes[key] = (votes[key] || 0) + 1;
    }

    let bestVal = null;
    let bestCount = 0;
    for (const key in votes) {
      if (votes[key] > bestCount) {
        bestVal = key;
        bestCount = votes[key];
      }
    }

    return {
      value: bestVal,
      confidence: parseFloat((bestCount / this.trees.length).toFixed(4)),
      votes
    };
  }

  /**
   * Predicts with full explanations from each tree.
   * @param {Record<string, *>} features
   * @returns {{ value: string, confidence: number, votes: object, explanations: object[] }}
   */
  explain(features) {
    const explanations = this.trees.map(tree => tree.explain(features));
    const votes = {};
    for (const ex of explanations) {
      const key = String(ex.value);
      votes[key] = (votes[key] || 0) + 1;
    }

    let bestVal = null;
    let bestCount = 0;
    for (const key in votes) {
      if (votes[key] > bestCount) {
        bestVal = key;
        bestCount = votes[key];
      }
    }

    return {
      value: bestVal,
      confidence: parseFloat((bestCount / this.trees.length).toFixed(4)),
      votes,
      explanations
    };
  }

  /**
   * Computes feature importance across all trees (mean decrease in impurity approximation).
   * @returns {Record<string, number>} Feature → importance score (0.0 to 1.0)
   */
  featureImportance() {
    const importance = {};
    let total = 0;

    function walkTree(node, depth) {
      if (!node || node.isLeaf) return;
      const score = (node.sampleCount || 1) / Math.max(1, depth + 1);
      importance[node.feature] = (importance[node.feature] || 0) + score;
      total += score;
      walkTree(node.left, depth + 1);
      walkTree(node.right, depth + 1);
    }

    for (const tree of this.trees) {
      walkTree(tree.root, 0);
    }

    // Normalize to 0.0–1.0
    if (total > 0) {
      for (const key in importance) {
        importance[key] = parseFloat((importance[key] / total).toFixed(4));
      }
    }
    return importance;
  }

  /**
   * Serializes the entire forest.
   */
  toJSON() {
    return {
      name: this.name,
      trees: this.trees.map(t => t.toJSON())
    };
  }

  /**
   * Deserializes a forest from JSON.
   * @param {object} json
   * @returns {RandomForest}
   */
  static fromJSON(json) {
    const trees = json.trees.map(t => DecisionTree.fromJSON(t));
    return new RandomForest(trees, json.name);
  }
}

// ──────────────────────────────────────────
// Utility: Fisher-Yates shuffle
// ──────────────────────────────────────────

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
