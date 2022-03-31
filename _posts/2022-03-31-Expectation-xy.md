---
layout: post
title: A quick Note&#58; Some &#171;Trivia&#187; about Joint Expectations
author: Ry Auscitte
category: data science blog
comments: true
description: Brings to the reader's attention a trivial property of joint expectations that many people use without giving it too much thought.
tags:
    - statistics
uses_math: true
---

## Intro

The subject of this post is rather trivial and, for this reason, its understanding is often assumed and taken for granted. We will discuss a property of expectation over a joint distribution of random variables that is implicitly used in many derivations, but rarely explicitly stated and I invite the reader to take a minute to convince themselves that it actually holds. Please, join in. 

Let us now formulate this artfully surrounded by an air of mysticism (with the intention to lure in unsuspecting readers, of course) property.

{% capture alert-text %}
An expectation over a joint distribution of multiple variables of an expression that depends on a proper subset of these variables  can be reduced to that computed over a marginal distribution of the variables involved or, in mathematical notation, 
$$E_{X_1,\dots,X_n}[f(X_{i_1},\dots,X_{i_k})] = E_{X_{i_1},\dots,X_{i_k}}[f(X_{i_1},\dots,X_{i_k})], \quad i_j \in \{1,2,\dots,n\} \mbox{  for } j = \overline{1,k}$$
{% endcapture %}
{% include definition-box.html text=alert-text title="A Property of Joint Expectations" %} 

Before moving forward, let us take a note of the notation. It is considered a good practice to list variables relative to which the expectation is computed in subscript next to the "E" sign. For example, taking the expectation $$E_{X}[X^3 \cdot Y^2]$$, provided $$X$$ and $$Y$$ are continuous, will result in the following integral: $$Y^2 \cdot \int X^3 \cdot p(X)\,dX$$ , whereas $$E_{XY}[3\cdot X \cdot Y^2]$$ is computed as $$\iint X^3 \cdot Y^2 \cdot p(X, Y) \,dX \,dY$$.

## The Proof

For the sake of simplicity and brevity, we will limit ourselves to $$E_{XY}[f(Y)] = E_{Y}[f(Y)]$$; naturally, the proof can be easily generalized to the case of an arbitrary number of variables. 

Let $$X$$ and $$Y$$ be random variables with domains $$D_X$$ and $$D_Y$$ respectively. Assuming both variables to be _continuous_, the derivation steps below constitute the desired proof.
$$
\begin{align*}
	E_{XY}[f(Y)] & = \int_{D_X} \int_{D_Y} f(Y) \cdot p(Y, X) \,dY\,dX = \int_{D_X} \int_{D_Y} f(Y) \cdot p(Y) \cdot p(X | Y) \,dX\,dY = \\ 
	& = \int_{D_Y} f(Y) \cdot p(Y) \cdot \underbrace{\left(\int_{D_X} p(X|Y) \,dX\right)}_{= \;1} \,dY = \int_{D_Y} f(Y) \cdot p(Y) \,dY = E_Y[f(Y)]
\end{align*}
$$

In the case of _discrete_ variables, additional assumptions are necessary: 

$$D_X = \{x_1, x_2, \dots, x_{d_X}\};\quad \left(\mid D_X\mid  = d_X\right)$$ 

and

$$D_Y = \{y_1, y_2, \dots, y_{d_Y}\};\quad (\mid D_Y\mid  = d_Y)$$

then the following holds:

$$
\begin{align*}
	E_{XY}[f(Y)] &= \sum_{i = 1}^{d_X} \sum_{j = 1}^{d_Y} f(y_j) \cdot p(X = x_i, Y = y_j) = \sum_{i = 1}^{d_X} \sum_{j = 1}^{d_Y} f(y_j) \cdot p(Y = y_j) \cdot p(X = x_i | Y = y_j) = \\
	& = \sum_{j = 1}^{d_Y} f(y_j) \cdot p(Y = y_j) \cdot \underbrace{\left(\sum_{i = 1}^{d_X}  p(X = x_i| Y = y_j)\right)}_{=\;1} = \sum_{j = 1}^{d_Y} f(y_j) \cdot p(Y = y_j) = E_Y[f(Y)]
\end{align*}
$$

-- Ry Auscitte

