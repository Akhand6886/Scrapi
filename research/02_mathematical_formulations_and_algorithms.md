# Chapter 2: Mathematical Formulations & Algorithmic Foundations

## 2.1 Formal Theory of CART Decision Trees in Scrapi

Classification and Regression Trees (CART), pioneered by Breiman et al. (1984), provide non-parametric, deterministic partition functions over multidimensional feature spaces. Scrapi implements a zero-dependency, pure JavaScript execution engine of CART optimized for microsecond runtime inference within the V8 engine.

```mermaid
graph TD
    Node["Split Node (Feature X_j, Op, Threshold θ)"]
    Node -->|Eval(x_j) == true| LeftChild["Left Subtree S_L"]
    Node -->|Eval(x_j) == false| RightChild["Right Subtree S_R"]
    LeftChild --> LeafA["Leaf Node: Value v, Confidence c"]
    RightChild --> LeafB["Leaf Node: Value v', Confidence c'"]
```

### 2.1.1 Mathematical Formulation of Tree Structure
A decision tree $T$ is a directed acyclic tree graph $T = (V, E)$ partitioned into:
- **Internal Split Nodes** $V_I \subset V$: Each node $u \in V_I$ is defined by a triplet $\langle X_j, \odot, \theta \rangle$, where $X_j$ is a feature index, $\odot \in \{<, \le, >, \ge, =, \neq, \in, \ni\}$ is a relational operator, and $\theta$ is a scalar or set-valued threshold.
- **Terminal Leaf Nodes** $V_L \subset V$: Each leaf $w \in V_L$ outputs a prediction tuple $\langle \hat{y}, c, \lambda, \mu \rangle$, where $\hat{y}$ is the predicted class, $c \in [0, 1]$ is the empirical posterior confidence, $\lambda$ is a human-interpretable explanatory string, and $\mu$ is auxiliary domain metadata.
- **Edges** $E \subset V \times V$: Directed transitions $(u, v)$ corresponding to binary truth valuations:
  $$\text{Branch}(u, \mathbf{x}) = \begin{cases} \text{left}(u) & \text{if } x_j \odot \theta \\ \text{right}(u) & \text{otherwise} \end{cases}$$

### 2.1.2 Partitioning and Impurity Metrics
During tree construction, feature space $S$ is partitioned into disjoint subspaces $S_L$ and $S_R$. The optimal split maximizes the Information Gain $\Delta I$:
$$\Delta I(S, \langle X_j, \odot, \theta \rangle) = I(S) - \left( \frac{|S_L|}{|S|} I(S_L) + \frac{|S_R|}{|S|} I(S_R) \right)$$

Where impurity $I(S)$ is evaluated via either **Gini Impurity** or **Shannon Entropy**:

$$\text{Gini Impurity: } I_G(S) = 1 - \sum_{k=1}^C p_k^2$$

$$\text{Shannon Entropy: } I_E(S) = - \sum_{k=1}^C p_k \log_2(p_k)$$

Where $p_k = \frac{1}{|S|} \sum_{i=1}^{|S|} \mathbb{I}(y_i = k)$ represents the empirical class distribution of class $k$ in partition $S$.

---

## 2.2 Mathematical Model: Autonomous Tier Router (`TierRouterTree`)

The Tier Router evaluates an initial lightweight HTTP probe signal vector $\mathbf{x}_{\text{probe}}$ to predict the execution tier $\hat{y} \in \{\text{static}, \text{dynamic}, \text{stealth}\}$:

$$\mathbf{x}_{\text{probe}} = \begin{bmatrix} s \\ L_{\text{body}} \\ \mathbb{I}_{\text{cf}} \\ \mathbb{I}_{\text{spa}} \\ \mathbb{I}_{\text{noscript}} \end{bmatrix} \in \mathbb{R}^2 \times \{0, 1\}^3$$

Where:
- $s \in \mathbb{N}$: HTTP response status code (e.g., $200, 403, 429, 503$).
- $L_{\text{body}} \in \mathbb{N}_0$: Payload character length ($| \text{rawHtml} |$).
- $\mathbb{I}_{\text{cf}} \in \{0, 1\}$: Binary indicator for anti-bot signatures:
  $$\mathbb{I}_{\text{cf}} = \mathbb{I}\left( \text{Regex}(\text{cf-turnstile} \mid \text{just a moment...} \mid \text{ddos-guard}) \subseteq \text{rawHtml} \right)$$
- $\mathbb{I}_{\text{spa}} \in \{0, 1\}$: Binary indicator for unhydrated Single Page Application root containers:
  $$\mathbb{I}_{\text{spa}} = \mathbb{I}\left( \text{Regex}(<\text{div id}=["'](\text{root}\mid\text{app}\mid\_\_\text{next})["']>\s*</\text{div}>) \subseteq \text{rawHtml} \right)$$
- $\mathbb{I}_{\text{noscript}} \in \{0, 1\}$: Binary indicator for client-side JavaScript enforcement tags.

### Decision Path Logic
The routing function $f_{\text{router}}: \mathbf{x}_{\text{probe}} \mapsto \{\text{static}, \text{dynamic}, \text{stealth}\}$ satisfies:

$$f_{\text{router}}(\mathbf{x}) = \begin{cases}
\text{stealth} & \text{if } \mathbb{I}_{\text{cf}} = 1 \lor s \in \{403, 429, 503\} \\
\text{dynamic} & \text{else if } \mathbb{I}_{\text{spa}} = 1 \lor \mathbb{I}_{\text{noscript}} = 1 \lor L_{\text{body}} < 300 \\
\text{static} & \text{otherwise}
\end{cases}$$

---

## 2.3 Mathematical Model: DOM Content Extractor & Information Density

To extract article root elements without human selector curation, Scrapi defines an **Information Density Formulation**.

For each candidate DOM node $e \in V_{\text{DOM}}$:

### 1. Link Density ($\rho_{\text{link}}$)
Measures the proportion of hyperlinked navigational boilerplate within candidate element $e$:
$$\rho_{\text{link}}(e) = \frac{\sum_{a \in \text{Anchors}(e)} |\text{text}(a)|}{\max(|\text{text}(e)|, 1)} \in [0, 1]$$

### 2. Paragraph Ratio ($\rho_{\text{p}}$)
Measures the density of formatted narrative content relative to all child DOM nodes:
$$\rho_{\text{p}}(e) = \frac{\sum_{p \in \text{Children}_p(e)} |\text{text}(p)|}{\max(|\text{text}(e)|, 1)} \in [0, 1]$$

### 3. Lexical Token Sentiment ($S_{\text{token}}$)
Computes attribute relevance from class and ID naming conventions:
$$S_{\text{token}}(e) = \sum_{t \in \text{Tokens}(e)} \left( \mathbb{I}(t \in \mathcal{P}) - \mathbb{I}(t \in \mathcal{N}) \right)$$
Where $\mathcal{P} = \{\text{article}, \text{post}, \text{content}, \text{entry}, \text{main}, \text{story}\}$ and $\mathcal{N} = \{\text{sidebar}, \text{comment}, \text{footer}, \text{nav}, \text{widget}, \text{ad}\}$.

### 4. Composite Scoring Formulation
The continuous scalar score $\Phi(e)$ combining the decision tree leaf classification weight $W_{\text{leaf}} \in [0, 1]$ with a logarithmic volume dampener is given by:

$$\Phi(e) = W_{\text{leaf}} \cdot \min\left( \frac{\log_{10}(\max(|\text{text}(e)|, 10))}{4}, 1.2 \right) \cdot (1 - \rho_{\text{link}}(e))$$

$$\text{Optimal Root Node } e^* = \arg\max_{e \in V_{\text{DOM}}} \Phi(e)$$

---

## 2.4 Mathematical Model: Adaptive Element Fingerprinting & Self-Healing Locators

When DOM redesigns mutate class names, IDs, or structural hierarchy, Scrapi recovers targets through a **Multi-Attribute Weighted Vector Similarity Metric**.

An element fingerprint is modeled as a 5-tuple:
$$\mathbf{F}(e) = \langle \tau, \iota, \mathcal{C}, \sigma, \pi, \kappa \rangle$$
Where $\tau$ is HTML tag name, $\iota$ is element ID, $\mathcal{C}$ is class token set, $\sigma$ is normalized text snippet, $\pi$ is parent tag name, and $\kappa$ is hierarchical DOM path.

The similarity function $\text{Sim}(\mathbf{F}_1, \mathbf{F}_2)$ between original fingerprint $\mathbf{F}_1$ and candidate node $\mathbf{F}_2$ is defined as:

$$\text{Sim}(\mathbf{F}_1, \mathbf{F}_2) = w_{\tau} \mathbb{I}(\tau_1 = \tau_2) + w_{\iota} \mathbb{I}(\iota_1 = \iota_2) + w_{\mathcal{C}} J(\mathcal{C}_1, \mathcal{C}_2) + w_{\pi} \mathbb{I}(\pi_1 = \pi_2) + w_{\sigma} \Lambda(\sigma_1, \sigma_2)$$

Subject to normalized weight constraints:
$$w_{\tau} + w_{\iota} + w_{\mathcal{C}} + w_{\pi} + w_{\sigma} = 1.0$$
$$\text{Default weights: } w_{\iota} = 0.30,\ w_{\mathcal{C}} = 0.25,\ w_{\tau} = 0.20,\ w_{\sigma} = 0.15,\ w_{\pi} = 0.10$$

### Component Metrics
1. **Jaccard Similarity for Class Token Sets**:
   $$J(\mathcal{C}_1, \mathcal{C}_2) = \frac{|\mathcal{C}_1 \cap \mathcal{C}_2|}{|\mathcal{C}_1 \cup \mathcal{C}_2|}$$

2. **Normalized Levenshtein Edit Distance for Snippets**:
   $$\Lambda(\sigma_1, \sigma_2) = 1 - \frac{\text{LevenshteinDist}(\sigma_1, \sigma_2)}{\max(|\sigma_1|, |\sigma_2|)}$$

3. **Heuristic Recovery Threshold**:
   A candidate $e'$ is recognized as a healed match if and only if:
   $$\text{Sim}(\mathbf{F}_{\text{orig}}, \mathbf{F}(e')) \ge \theta_{\text{heal}} \quad (\text{where } \theta_{\text{heal}} = 0.65)$$

---

## 2.5 Algorithmic Complexity Bounds

| Algorithm | Theoretical Time Complexity | Empirical Latency (V8 Runtime) | Memory Complexity |
|---|---|---|---|
| **CART Tree Traversal (v2.0, Depth ≤ 14)** | $\mathcal{O}(D)$ where $D \le 14$ | **$12 - 38\ \mu\text{s}$** | $\mathcal{O}(1)$ |
| **DOM Feature Extraction (v2.0)** | $\mathcal{O}(N)$ where $N$ is element count | **$60 - 210\ \mu\text{s}$** | $\mathcal{O}(N)$ |
| **Random Forest Inference (7 Trees)** | $\mathcal{O}(B \cdot D)$ where $B=7, D \le 8$ | **$45 - 90\ \mu\text{s}$** | $\mathcal{O}(B)$ |
| **Adaptive Selector Relocation** | $\mathcal{O}(K \cdot |\mathcal{C}|)$ where $K$ is tag matches | **$0.8 - 2.5\ \text{ms}$** | $\mathcal{O}(K)$ |
| **Markdown Conversion (GFM)** | $\mathcal{O}(N)$ linear DOM traversal | **$4 - 12\ \text{ms}$** | $\mathcal{O}(N)$ |

---

## 2.6 Mathematical Formulation: Pure JS Supervised CART Training (`DecisionTree.fit`)

Scrapi v2.0 introduces an integrated recursive binary tree learner implementing the standard Breiman CART induction algorithm in pure JavaScript without external dependencies.

Given training samples $\mathcal{D} = \{(\mathbf{x}_i, y_i)\}_{i=1}^N$ where $\mathbf{x}_i \in \mathbb{R}^M$ and $y_i \in \mathcal{Y}$:

### 1. Optimal Split Selection via Weighted Impurity Minimization
For every candidate feature $X_j$ and observed threshold value $\theta \in \text{Unique}(X_j)$:
$$\mathcal{D}_L = \{(\mathbf{x}_i, y_i) \mid x_{i,j} \le \theta\}, \quad \mathcal{D}_R = \{(\mathbf{x}_i, y_i) \mid x_{i,j} > \theta\}$$

The candidate split $\langle X_j^*, \theta^* \rangle$ is chosen to minimize the weighted partition Gini impurity:
$$\langle X_j^*, \theta^* \rangle = \arg\min_{j, \theta} \left[ \frac{|\mathcal{D}_L|}{|\mathcal{D}|} I_G(\mathcal{D}_L) + \frac{|\mathcal{D}_R|}{|\mathcal{D}|} I_G(\mathcal{D}_R) \right]$$

### 2. Stopping Conditions
Recursive partitioning terminates when:
- Current depth $d \ge d_{\max}$ (maximum tree depth limit, default $d_{\max}=8$).
- Partition cardinality $|\mathcal{D}| < N_{\min}$ (minimum samples for split, default $N_{\min}=2$).
- Partition impurity $I_G(\mathcal{D}) = 0$ (all instances belong to a single class).
- No valid split yields $\Delta I_G > 0$.

Upon termination, leaf node assigns the majority class:
$$\hat{y} = \arg\max_{c \in \mathcal{Y}} \sum_{i \in \mathcal{D}} \mathbb{I}(y_i = c), \quad \text{confidence} = \frac{1}{|\mathcal{D}|} \sum_{i \in \mathcal{D}} \mathbb{I}(y_i = \hat{y})$$

---

## 2.7 Mathematical Formulation: Random Forest Ensemble (`RandomForest`)

To eliminate variance and prevent overfitting on anomalous page structures, Scrapi v2.0 implements **Bootstrap Aggregated (Bagging) Random Forests** with feature subsampling.

### 1. Bagging & Feature Subsampling
Given $B$ constituent trees $\{T_1, T_2, \dots, T_B\}$:
- Each tree $T_b$ is trained on a bootstrap sample $\mathcal{D}_b^*$ drawn with replacement from $\mathcal{D}$ ($|\mathcal{D}_b^*| = \lfloor \gamma N \rfloor$, default $\gamma = 0.8$).
- At each split candidate, only a random subset of features $M_{\text{sub}} = \lceil\sqrt{M}\rceil$ is evaluated.

### 2. Ensemble Majority Voting & Confidence
$$\hat{y}_{\text{forest}}(\mathbf{x}) = \arg\max_{c \in \mathcal{Y}} \sum_{b=1}^B \mathbb{I}(T_b(\mathbf{x}) = c)$$
$$\text{Confidence}(\mathbf{x}) = \frac{1}{B} \sum_{b=1}^B \mathbb{I}(T_b(\mathbf{x}) = \hat{y}_{\text{forest}})$$

### 3. Mean Decrease in Impurity (MDI) Feature Importance
Feature importance $\mathcal{I}(X_j)$ is computed across the ensemble by weighting sample counts inversely by tree depth:
$$\mathcal{I}(X_j) = \frac{\sum_{b=1}^B \sum_{u \in V_I(T_b) \mid \text{feature}(u) = X_j} \frac{N_u}{d_u + 1}}{\sum_{\text{all internal nodes } v} \frac{N_v}{d_v + 1}}$$
Normalized such that $\sum_{j=1}^M \mathcal{I}(X_j) = 1.0$.

---

## 2.8 Depth-Calibrated Adaptive Confidence Decay

In deep heuristic decision chains, prolonged traversal paths through multiple fallbacks signify edge-case documents that deviate from canonical archetypes. Scrapi v2.0 formalizes this with **Depth-Calibrated Adaptive Confidence Decay**:

$$c_{\text{adjusted}}(\mathbf{x}) = c_{\text{leaf}} \cdot \max\left( \delta_{\min},\ 1.0 - \max(0, D(\mathbf{x}) - D_{\text{nominal}}) \cdot \kappa \right)$$

Where:
- $c_{\text{leaf}} \in [0, 1]$ is the empirical posterior leaf confidence.
- $D(\mathbf{x})$ is the observed traversal depth for input $\mathbf{x}$.
- $D_{\text{nominal}} = 6$ is the nominal baseline depth threshold below which zero decay occurs.
- $\kappa = 0.01$ is the linear depth decay coefficient per step past nominal.
- $\delta_{\min} = 0.85$ is the floor bounding maximum penalty at $15\%$.
