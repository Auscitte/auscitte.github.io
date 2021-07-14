---
layout: post
title: A Quick Note &#58 Installing Python Wheels Programmatically
author: Ry Auscitte
category: data science blog
comments: true
description: Explains how to code a wheel installiation script in Python 
tags:
    - Python
---

## A Quick Note: Installing Python Wheels Programmatically

If for whatever reason you wish to install Python wheels using a Python script you can do so as described below. 

First of all, one needs to determine which wheel to choose in accordance with the platform, Python implementation, etc.  Here is an example.

Figuring out python which Python implementation you have installed: 

{% include code-block-header.html title="Python Implementation" %}
{% highlight python linenos %}

>>> import platform
>>> platform.python_implementation()
'CPython'
>>>

{% endhighlight %} 

Determining whether your Python binaries are 32 or 64-bit:

{% include code-block-header.html title="Python Binaries Architecture" %}
{% highlight python linenos %}

>>> import struct
>>> 8 * struct.calcsize("P")
64

{% endhighlight %} 

And here is how you can find out the operating system under which the script is executed:


{% include code-block-header.html title="Operating System" %}
{% highlight python linenos %}

>>> import platform
>>> platform.system()
'Linux'
>>> platform.machine()
'x86_64'

{% endhighlight %}

The requirements are encoded into the file name of a wheel. For example: “torch-1.1.0-cp35-cp35m-linux_x86_64.whl” is a PyTorch wheel for CPython 3.5 run on 64-bit Linux platform. A more detailed explanation is to be found in Brett Cannon's excellent [blog post](https://snarky.ca/the-challenges-in-designing-a-library-for-pep-425/). 

Having identified the wheel, installing it is a simple matter. It is advisable to begin by upgrading pip to the latest version. 

{% include code-block-header.html title="Upgrading Pip" %}
{% highlight bash linenos %}

python3.5 -m pip install --upgrade pip

{% endhighlight %}

Finally, run the following script passing it a path to a predownloaded wheel file as a parameter:

{% include code-block-header.html title="Installing a Wheel" %}
{% highlight python linenos %}

import pip._internal as p

w = p.wheel.Wheel(sys.argv[1])
if not w.supported():
	print(p.pep425tags.get_supported())
else:
	p.main(['install', sys.argv[1]])

{% endhighlight %}

Using these simple code snippets, one can easily put together an installation script tailored to the task one is faced with. 

## References

Brett Cannon, [The challenges in designing a library for PEP 425 (aka wheel tags)](https://snarky.ca/the-challenges-in-designing-a-library-for-pep-425/), 2019

