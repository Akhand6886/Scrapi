# Scrapi Research Dossier: Autonomous, Adaptive, and Resilient Web Scraping

## Executive Abstract
This research dossier investigates the theoretical foundations, algorithmic formulations, and empirical performance of **Scrapi**—an adaptive, high-throughput web scraping and autonomous crawling framework implemented in Node.js. 

Modern web architecture has evolved significantly with client-side hydration frameworks (React, Next.js, Vue), dynamic DOM mutations, and sophisticated bot management systems (Cloudflare Turnstile, DataDome, PerimeterX). Traditional scraping engines (e.g., Scrapy, BeautifulSoup, raw Puppeteer) suffer from significant trade-offs: either high execution latency and memory overhead from indiscriminate headless browser usage, or brittleness due to rigid static selectors and manual trial-and-error escalation.

Scrapi introduces a novel **Three-Pillar Autonomous Architecture**:
1. **Zero-Dependency CART Decision Tree Subsystem**: Sub-millisecond heuristic inference for autonomous fetcher tier routing, DOM content extraction, and crawl frontier prioritization.
2. **Adaptive Self-Healing Element Locators**: Resilient element fingerprinting and weighted tree-distance recovery algorithms that automatically adapt to DOM redesigns.
3. **Progressive Multi-Tier Fetcher Engine**: Autonomous zero-overhead static probing with conditional escalation to headless Chromium and stealth evasion contexts.

---

## Research Table of Contents

| Chapter | Document | Primary Focus |
|---|---|---|
| **01** | [Literature Review & Comparative Analysis](01_literature_review_and_comparative_analysis.md) | Survey of state-of-the-art scraping paradigms, academic content extraction algorithms, and comparative benchmark taxonomy. |
| **02** | [Mathematical Formulations & Algorithms](02_mathematical_formulations_and_algorithms.md) | Mathematical modeling of CART split mechanics, Gini impurity, Information Density metrics, and similarity distances. |
| **03** | [Autonomous Tier Routing & Anti-Bot Evasion](03_autonomous_tier_routing_and_anti_bot_evasion.md) | Threat modeling of anti-bot defenses, client fingerprint masking, and zero-duplicate probe routing heuristics. |
| **04** | [Experimental Methodology & Empirical Benchmarks](04_experimental_methodology_and_empirical_benchmarks.md) | Controlled experimental setup, latency/throughput profiling across query engines, and memory stress tests. |
| **05** | [Crawl Frontier & Graph Traversal Optimization](05_crawl_frontier_and_graph_traversal_optimization.md) | Web graph topology, priority queue heuristics, duplicate detection, and checkpoint state persistence. |
| **06** | [Future Directions & Hybrid LLM Architectures](06_future_directions_and_llm_integration.md) | Trade-offs between microsecond deterministic trees vs token-heavy LLMs, and online reinforcement learning frontiers. |

---

## Research Questions (RQs)

This research investigates the following central questions:

- **RQ1 (Routing Efficiency)**: *Can an autonomous CART decision tree predict the optimal fetching tier (Static HTTP, Dynamic Browser, or Stealth Context) from initial lightweight probe signals in <150 µs without introducing duplicate network request overhead?*
- **RQ2 (Extraction Robustness)**: *How effectively does combining link density, text-to-tag ratios, and lexical sentiment tokens in a decision tree isolate main article bodies compared to standard CSS/XPath selectors across shifting DOM topologies?*
- **RQ3 (Locator Resilience)**: *Can self-healing element locators utilizing multi-attribute structural fingerprints recover mutated target nodes with high confidence (>80%) following class/ID refactoring?*
- **RQ4 (Throughput & Resource Utilization)**: *What is the quantitative throughput and memory advantage of connection-pooled, conditionally-cached Node.js architectures over conventional Python-based multi-process scrapers?*

---

## Core Hypotheses

$$\begin{aligned}
\mathbf{H_1} &: \text{Autonomous probe evaluation achieves } \ge 98\% \text{ routing accuracy while eliminating } 100\% \text{ of manual tier selection.} \\
\mathbf{H_2} &: \text{Inference latency for pre-compiled CART decision trees in V8 remains strictly } < 50 \mu\text{s, negligible compared to network RTT.} \\
\mathbf{H_3} &: \text{Adaptive fingerprint matching restores mutated DOM selections in } < 2 \text{ ms with zero external server dependencies.}
\end{aligned}$$
