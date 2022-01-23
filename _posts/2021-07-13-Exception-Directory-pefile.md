---
layout: post
title: Boots for Walking Backwards&#58 Teaching pefile How to Understand SEH-Related Data in 64-bit PE Files
author: Ry Auscitte
category: systems blog
comments: true
description: Explains how SEH-related data is stored in 64-bit PE+ files and used by Windows to perform stack unwinding and documents the process of implementing an extension to pefile that would read relevant sections of PE+ images.
tags:
    - PE
    - stack unwinding
    - prolog
    - epilog
    - reverse engineering
    - SEH
redirect_from: /systems blog/Exception-Directory-pefile
---

## Prologue

Particularly faithful readers stoically following the adventure of [bringing my OS back from the abyss][abyss] may have noticed a certain _python_ library for parsing _Window Portable Executable (PE)_ format appearing here and there throughout the article series. It is [**pefile**][pefile] by Ero Carrera and I found it immensely useful. Naturally, it was the first library that I thought of when the subject of stack unwinding on 64-bit platforms spiked my interest. It so happened, the required functionality was not in the library and I decided to fill the void. 

That said, my focus was on x64 native code specifically and, while my implementation should work with IA64 binaries by extension, it does not take into account other architectures (such as ARM). I left those for another willing sole to work on. 

{% capture alert-text %}
Anyone believing that the source code is better than a thousand words documenting it may proceed straight to the [implementation](https://gist.github.com/Auscitte/1433a78d71c5f01c889243f45c04de01).
{% endcapture %}
{% include note-box.html text=alert-text %}

## Introduction

Windows implements a mechanism called **_Structured Exception Handling (SEH)_** that gives users, applications, and drivers an opportunity to respond to exceptions in a stratified fashion. Assuming the reader could not have possibly avoided exposure to the ubiquitous information on the subject, I will only recap the main points. 

### The Origin

An exception, whether hardware- or software-initiated, is initially processed by a kernel-mode handler routine  assigned to its exception number by the _Interrupt Dispatch/Descriptor Table (IDT)_. _Intel’s 64 and AI-32 Architectures Developer’s Manual_ classifies exceptions as faults, traps and aborts depending on their severity and whether the originating instruction could be restarted and the program execution, continued without loss of state. The respective exception handler routines are called fault, trap, or abort handlers. In the following we talk about the exceptions that are not considered fatal or (silently) dealt with by the OS itself. 

The said routine creates a _trap frame_, containing a subset of register values, and an exception record on the kernel-mode stack. If the exception was caused by the code running in _kernel mode_, the process of locating an appropriate developer-supplied exception handler starts right away (subject to IRQ level checks). For _user-mode_ exceptions, the processing is a bit more involved; it begins with an elaborate dance of _exception dispatcher_, _exception port_, and _debug port_ trio resulting in the first- and second-chance exceptions all user-mode _Windows_ developers are well familiar with (implementation details can be found in the “System Mechanisms” chapter of _Windows Internals_). When no debugger is activated to deal with the exception, CPU is switched back into _user mode_, the trap frame and exception information being copied onto the _user-mode stack_, and the system tries to locate a handler for this exception within the application (or service) itself.  This is where the processing routes (or algorithmic pathways, if you will) for kernel-mode and user-mode exceptions converge, safe the privilege level.

### Locating Exception Handlers

With the introduction of _Windows ABI_ and _PE+_ format came a new method for locating a suitable exception handler on the stack of that thread-troublemaker. On good old _x86_ platforms, every function that wished to take part in _SEH_ would register its handler by inserting an entry into a _linked list of handlers_, the list that was maintained on stack with the address of its head stored in _Thread Information Block (TIB)_. The registration was done in function’s _prolog_; _epilog_ performed a matching set of instructions with the opposite effect of canceling the registration. The OS would look through the list of handlers, executing them one by one until the one that recognized the exception would be found (an excellent [article][x86seh] by Matt Pietrek is available for those craving more information on the subject). 

Windows uses another method, which an undisclosed correspondent of _NT Insider_ ;-) refers to in their [article][osrseh] as _“table-based”_, to implement SEH in 64-bit software. An extended version of **_Portable Executable (PE+)_** format was designed for 64-bit binaries. Stored inside the _64-bit PE+_ image file, is a so-called **_“exception directory”_** with an entry for every non-leaf function (a _leaf function_ does not modify non-volatile registers, use stack, or call other functions, thereby ensuring **_rsp_** points to one byte past the return address at all times). Every function utilizing `__try`/`__except`/`__finally` constructs has in its _exception directory_ entry a reference to a (usually, compiler-supplied) function, which, when called, would invoke the code within `__except` and `__finally` blocks; and this is how OS is able to locate the handlers. As Matt Miller (aka epakskape or skape) [points out][x64scape], this approach is beneficial in two ways: firstly, it is no longer susceptible to buffer overflow attacks and, secondly, there is no overhead associated with maintaining the linked list of handlers. 

### Providing Execution Context for Exception Handlers

Moving on, the faulty function may not be able to handle the exception at hand, while some of its predecessors down the call stack has a facility to do so. Activating this savvy handler is, however, problematic for it must be called “in the context” of the function where the corresponding exception handler was defined. Let me explain. 

{% highlight c linenos %}
void take_dubious_action() 
{
	IMPORTANT_DATA data;
	initialize_data(&data);
	__try {
		make_trouble(&data);
		printf("Phew!");
	}
	__finally {
		free_data(&data);
	}
}
{% endhighlight %}

Above is, probably, the simplest possible example demonstrating the issue; therein we assume that some instruction in `make_trouble()` causes an exception of some sort. 
 
Notice `__finally` block of `take_dubious_action()` referencing a local variable named `data` in line **10**; in general, code within `__except` and `__finally` blocks needs a way of accessing local variables and the arguments passed to its parent function. The task is accomplished with the help of **_rsp_** or **_rbp_**  (relative to which addresses on stack are computed) and non-volatile registers, where first four function arguments and, possibly, some of local variables are stored. What the system would like to have at its disposal is the thread context initialized exactly as it would have been at the instruction following the call to `make_trouble()` (in this case, moving an address of `"Phew!"` to **_rcx_** in preparation for the `printf` call); apart from the volatile registers, which nobody cares about.

{% capture alert-text %}
**_Volatile registers_** are not expected to retain their values across function calls.
{% endcapture %}
{% include info-box.html text=alert-text %}

{% include fill-centered-fig.html filename="pefileseh_C_specific_handler.png" alt="Execution Context for a __finally Block" %}

On this screenshot of _Visual Studio_’s Debugger, one can observe `_C_specific_handler()` being passed as the argument named `ContextRecord` just the thread context we need. How do we know it? Well, on _x64_ platforms, when dynamic stack allocation (_alloca()_) is not used, the stack frame can be identified by the value of **_rsp_** register, so let us see what this value was for `take_dubious_action()`.

{% include fill-centered-fig.html filename="pefileseh_establisher_stack_frame.png" alt="Execution Context take_dubious_action()" %}

Compare the value of **_rsp_** with the one recorded in `ContextRecord` and let me assure you that the rest of non-volatile registers are initialized correctly as well. `_C_specific_handler()`, in turn, executes the code in `__finally` and `__except` blocks.

### Stack Unwinding

So far so good, but where did that `ContextRecord` come from?  `_C_specific_handler()` is called from somewhere in the depths of OS’s exception processing routines that were brought into action by a spurious instruction at a different place: namely, `make_trouble()`, and, for that reason, are blithely unaware of `take_dubious_action()`’s register values and stack frame location. Well, before `make_trouble()` makes itself at home on stack by establishing its frame and initializing variables, it courteously saves the values of non-volatile registers it is going to modify (including **_rsp_**). Thereby, everything `take_dubious_action()` (and `__finally` and `__except` blocks within, by extension) needs for its successful operation could be found on stack if only someone cleaned up after `make_trouble()` by reversing the effects of its prolog and it is exactly what is being done in this case. This procedure goes by the name of **_“stack unwinding”_**. Stack unwinding can be _virtual_ when the actual CPU registers are left untouched while the desired thread context is recorded in a structure instead. 

_Stack unwinding_ procedure must know what instructions (and in what order) are executed as part of the _prolog_, as well as some stable reference point in relation to which to compute the register addresses on stack. On _x86_ platforms, Windows acquired this information by analyzing machine codes constituting the function whose stack it was unwinding and relied on the value of _frame pointer_ (**_rbp_**) for reference (remember how compiler would not let you use frame pointer omission optimization together with SEH?). Key “skywing” Johnson calls this method _“code-driven”_ in his [“Programming against the x64 exception handling support” series][x64sehskywing]. 

When it came to _x64_ (and _IA64_), the implementation of stack unwinding received a major overhaul. Microsoft has done away with the calling conventions zoo and introduced a universal _Application Binary Interface (ABI)_. It brought a unified layout of function parameters in registers/on stack and some restrictions on stack alignment. The latter incurred changes in stack usage patterns thereby making **_rsp_** a more likely “stable reference”, but on that – later. The most significant (in setting of this work) novelty, however, is precise specification for the types of instructions that may appear in prolog or epilog of a function. Furthermore, _prologs_ are now present in the _PE+_ binary image in two forms simultaneously: regular machine code in _.text_ segment and sequences of architecture-independent data structures (one for each instruction in the prolog), stored in _.xdata_ segment and referenced by the entries for their respective functions in the _exception directory_. It is these structures (rather than the actual machine code) that Windows mostly relies on when unwinding stacks and, on account of this fact, the new unwind algorithm is referred to as _“data-driven”_ (as opposed to “code-driven”) in [skywing’s posts][x64sehskywing].

{% capture alert-text %}
Speaking of which, Ken Johnson goes into nitty-gritty implementation details of stack unwinding on _x64_, including **_collided_** (something of a curiosity in its own right) and **_consolidated unwinds_**, in the said series. Andrea Allievi further [expands][x64seh8.1] on the topic of _collided_ and _consolidated unwinds_ (with examples). I recommend checking out these sources most insistently to anyone interested in the subject.
{% endcapture %}
{% include note-box.html text=alert-text %}

### Motivation

Introduction of prolog-defining meta-data in _PE+_ along with new _stack unwinding_ procedures sent ripples of (albeit moderate, but yet) excitement through the debugging crowd. In his [“Improving Automated Analysis of Windows x64 Binaries”][x64scape], Matt Miller lists various applications thereof in binary analysis, for example. Ken Johnson also sings praises of this new approached to stack unwinding. “This is a very powerful capability indeed, as it allows for a much more complete and thorough traversal of call frames than ever possible on x86”, he [says][x64sehskywing].

The contribution to _pefile_ this article presents consists in parsing of the very _exception directory_ (along with the prolog code-related structures) I keep mentioning. With this addition to the library, anyone who desires to implement (64-bit) stack walking in _python_ and fancies employing _pefile_ for the purpose may now get straight to the business. 

Apart for me dismissively talking about _x86_ platforms as a thing of the past (which it is not), I hope, it was a satisfactory review of basic concepts for those who might have gotten a bit rusty in _SEH_ matters. Having gotten that out of the way, I can finally dive into the technical details. 

## Exception Directory Data Structures

For whatever reason, I liked this quote from [“Exceptional Behavior”][osrseh] by NT Insider, so I am using it in the way of an introductory paragraph: 
> Within a PE image there are various directories that contain information about the image. For example, if the image has any exports, there will be an export directory that describes the exports. In the case of an x64 image, there happens to be an exception directory that contains a variable number of RUNTIME_FUNCTION structures…

So `RUNTIME_FUNCTION` structure is defined [as follows][msseh]:

{% highlight c linenos %}
typedef struct _RUNTIME_FUNCTION {
    ULONG BeginAddress;
    ULONG EndAddress;
    ULONG UnwindData;
} RUNTIME_FUNCTION, *PRUNTIME_FUNCTION;
{% endhighlight %}

This definition is pretty much self-explanatory, the only useful remark being that all three addresses stored in this structure are actually offsets from the beginning of the binary image file. There is one such structure for every **_frame_** (i.e. non-leaf) **_function_** in the _exception directory_.

{% capture alert-text %}
Might I bring to your attention the requirement that this structure be present for every function, not just the ones that are being exported? This requirement greatly simplifies debugging in 64-bit lands, especially for modules without symbols (see [this post][FPO] for the explanation). 
{% endcapture %}
{% include note-box.html text=alert-text %}

Given how uninformative `RUNTIME_FUNCTION` appears, one might reasonably assume that all the juiciest bits are hidden away in **_“unwind data”_** stored at an RVA of `UnwindData`. Let us take a look (borrowed from [ducumentation][msseh]).

{% highlight c linenos %}
typedef struct _UNWIND_INFO {
    UBYTE Version       : 3;
    UBYTE Flags         : 5;
    UBYTE SizeOfProlog;
    UBYTE CountOfCodes;
    UBYTE FrameRegister : 4;
    UBYTE FrameOffset   : 4;
    UNWIND_CODE UnwindCode[1];
/*  UNWIND_CODE MoreUnwindCode[((CountOfCodes + 1) & ~1) - 1];
*   union {
*       OPTIONAL ULONG ExceptionHandler;
*       OPTIONAL ULONG FunctionEntry;
*   };
*   OPTIONAL ULONG ExceptionData[]; */
} UNWIND_INFO, *PUNWIND_INFO;
{% endhighlight %}

`Version`, to nobody’s surprise, holds the version of `UNWIND_INFO` structure. As of the time of writing, the newest encountered version is 2; it differs from the previous version of the same structure by (potential) presence of _EPILOG_ codes. Interestingly, only version 1 of `UNWIND_INFO` is fully documented.

Flag is an OR-combination of `UNW_FLAG_EHANDLER`, `UNW_FLAG_UHANDLER`, and `UNW_FLAG_CHAININFO`, such that (`UNW_FLAG_EHANDLER`, `UNW_FLAG_CHAININFO`) and (`UNW_FLAG_UHANDLER`, `UNW_FLAG_CHAININFO`) are pairwise mutually exclusive:

{% highlight c linenos %}
  !(Flags & (UNW_FLAG_UHANDLER | UNW_FLAG_EHANDLER)) || 
  !(Flags & UNW_FLAG_CHAININFO)
{% endhighlight %} 

thereby making only one: `ExceptionHandler` or `FunctionEntry` (from the union following the array of unwind codes) relevant at a time. Let us leave `UNW_FLAG_CHAININFO` alone for now and focus on exception handling.

{% capture alert-text %}
Just in case someone was wondering, the union containing `ExceptionHandler` or `FunctionEntry` is commented out (along with the `ExceptionData` that follows) due to the fact that the `UnwindCode[]` array has a variable number of elements which _C_ does not support. 
{% endcapture %}
{% include info-box.html text=alert-text %}

### Exception Handlers

The most observant among readers might have gotten perplexed by my use of `__try/__finally` block to demonstrate the need for setting up a proper execution context when invoking an exception handler (in `take_dubious_action()` example). Aren’t `__except` blocks supposed to deal with exceptions? Well, yes, but… 

From _C/C++ compiler_’s perspective, there are three sides to exception handling: exception filtering, exception processing, and termination (aka unwinding) handling. The former two are performed by filter expressions and compound statements inside `__except` blocks respectively, while `__finally` blocks and a special clean-up subroutine that calls destructors for local objects constitute the latter. Complex as it is, the picture would not be complete without mentioning the possibility of multiple (and even nested) `__try`/`__except` and `__try`/`__finally` blocks per function. 

As far as _Windows_ is concerned, there is only one function to do all that, the function whose RVA is stored in `ExceptionHandler`. Here is its prototype (as declared in [docs][msseh]):

{% highlight c linenos %}
typedef EXCEPTION_DISPOSITION (*PEXCEPTION_ROUTINE) (
    PEXCEPTION_RECORD ExceptionRecord,
    ULONG64 EstablisherFrame,
    PCONTEXT ContextRecord,
    PDISPATCHER_CONTEXT DispatcherContext
);
{% endhighlight %}

`ExceptionHandler` can be advertised as an **_exception handler_**, **_termination handler_**, or both by setting the appropriate flags in the corresponding `RUNTIME_FUNCTION` structure. It is a double-duty function in that it can be invoked twice – the first time, to handle the exception and the second time (with `(ExceptionRecord->ExceptionFlags & EXCEPTION_UNWIND) != 0` to distinguish between the calls), right before the function stack is unwound. To complicate the matter further, there are also secondary (“nested” or “chained”) exceptions and _collided unwinds_ to grapple with, but they are beyond the scope of this discussion.

Also among the topics we are not discussing here is the internal organization of `EXCEPTION_ROUTINE` as specific to the programming language and language runtime used. _Microsoft’s C compiler (MSVC)_, for example, employs `_C_specific_handler()` for the purpose. `ExceptionData[]` field of `RUNTIME_FUNCTION` is initialized with an instance of the `SCOPE_TABLE` structure listing all the `__try`/`__except` and `__try`/`__finally` blocks within the function; this data is what `_C_specific_handler()` relies on when determining which code to execute in response to an exception. More information on the subject can be found in Ken Johnson’s [posts][x64sehskywing].

One cannot stress enough how important stack unwinding is to exception handling. Let us begin by expanding the example given earlier a little.

{% highlight c linenos %}
void observe_caution() 
{
	int status = STATUS_NOTHING_DONE_YET;
	__try {
		take_dubious_action(&status);
	}
	__except(filter(GetExceptionCode(), status)) {
		log_exception(GetExceptionCode(), status);
	}
	
	do_more_useful_work(&status);
}
{% endhighlight %}

Now imagine some nefarious instruction in `make_trouble()` causes an exception. The system begins by (virtually) unwinding two stack frames in order to provide a proper execution context for calling `filter()` with the most current value of `status` as a parameter. Then, provided `filter()` returned  `EXCEPTION_EXECUTE_HANDLER`, Windows has to go back and check if `make_trouble()` needs to do some cleaning-up before terminating (in other words, it comes with a termination handler). After that, all traces of `make_trouble()` are erased from the stack and non-volatile registers are restored to establish a context for executing `__finally` block of `dubious_action()`. That done and `dubious_action()` properly terminated,  another stack unwind is in order. This time Windows needs to invoke an exception handler defined in `observe_caution()` and then pass control to the remainder of the function, which, in turn, would do “more useful work”.

Stack unwinding being an essential component of exception handling, the operating system must be able to unwind stacks for a variety of functions, ranging in complexity and programming languages used to implement them. In particular, it should be able to infer a layout of the function’s stack frame at any point in its execution. To this end, a reliable method of identifying if the function was interrupted in the middle of its prolog or epilog must exist. This is accomplished by posing tight restrictions on the content of function prologs and epilogs, compiler developers should familiarize themselves with by reading the [documentation][prologepilog]. 

To further aid the unwinding procedure, prolog is translated into a sequence of **_unwind codes_** to be stored as the `UnwindCode[]` array in `RUNTIME_FUNCTION`. By the way, the unwind codes are stored in _reverse order_; after all, this is the order a stack unwinding algorithm must follow to “undo” the effects of executing the prolog.

As expected, `RUNTIME_FUNCTION::CountOfCodes` gives us the number of `UNWIND_CODE`-sized slots the unwind codes occupy in the array, but, remarkably, not the number of codes itself for one code may be one to three slots in length. Moreover, length of `UnwindCode[]` must always be  even, irrespective of the actual number of unwind codes (thus, possibly, leaving one slot unused), hence the weird `(CountOfCodes + 1) & ~1` expression. 

### Unwind Codes

Despite vigorous protests about restrictions stifling their creativity (potentially) coming from imaginative compilers, prologs and epilogs may only alter the stack by means of instructions from a predefined set. These instructions are then translated into unwind codes.

A header for an unwind code is defined [as follows][msseh]:

{% highlight c linenos %}
typedef struct _UNWIND_CODE {
    UBYTE CodeOffset;
    UBYTE UnwindOp : 4;
    UBYTE OpInfo   : 4;
} UNWIND_CODE;
{% endhighlight %}

The `CodeOffset` field will tell you this instruction’s offset relative to the beginning of the function and `UnwindOp`, its type. Presented below are all possible (as of today) types of unwind codes along with their layouts in _PE+_ file and, where applicable, usage examples in the form of _NASM_ macros and matching assembler instructions.


<table>
<tr><th colspan="2" markdown="1">**UWOP\_PUSH\_NONVOL**</th></tr>
<tr ro>
<td rowspan="2">
{% highlight c linenos %}
struct _UNWIND_CODE_PUSH_NONVOL {
    UBYTE CodeOffset;
    UBYTE UnwindOp : 4;
    UBYTE Reg      : 4;
} UNWIND_CODE_PUSH_NONVOL;
{% endhighlight %}
</td>
<td><span markdown="1">`.PUSHREG RBX`</span></td>
</tr>
<tr>
<td><span markdown="1">`push rbx`</span></td>
</tr>
</table>

These are nothing more than the good old `push` instructions. 

Although I have nothing of importance to say about the `push` instructions themselves, it seems a suitable place to discuss the **_stack alignment_** requirements. _x64 ABI_ requests that **_rsp_** be 16-byte aligned when a `call` instruction is executed thereby enabling the callee to put its local variables on 16- or 8-byte boundaries and then use the optimal instructions to access them. Interestingly (though not surprisingly), Intel CPU follows the same guidelines on hardware level by making sure the stack pointer is 16-byte aligned before invoking an interrupt handler. “This allows the stack to be formatted for optimal storage of 16-byte XMM registers, which enables the interrupt handler to use faster 16-byte aligned loads and stores (MOVAPS rather than MOVUPS) to save and restore XMM registers.” Intel [explains][intel].

Now notice that a function actually starts off with an unaligned stack due to the `call` instruction pushing a _QWORD_-long return address on top of it. An often encountered at the very beginning of prolog `push rbp` will bring the proper alignment back, but only until the next `push` instruction is executed. Obviously, a function is not expected to maintain stack alignment during prolog/epilog. As to its body, this is what Rich Skorski has to [say][abiframes]:
>In the body of a function, RSP will usually be 16 byte aligned. The promise that needs to be kept is that the alignment of RSP will be known when you enter a function. If you don't call another function, there's no reason to keep that promise and the compiler can put RSP on whatever alignment it wants.

However, Microsoft’s [documentation][msstack] notes that normally “the stack will always be maintained 16-byte aligned, except within the prolog.” In order to understand the mechanism behind it, another class of instructions must be introduced.

<table>
<tr><th colspan="2" markdown="1">**UWOP\_ALLOC\_LARGE** and **UWOP\_ALLOC\_SMALL**</th></tr>
<tr>
<td>
{% highlight c linenos %}
/*(hdr.OpInfo & 0x1) == 0x0*/
struct _UNWIND_CODE_ALLOC_LARGE {
    UNWIND_CODE hdr;
    WORD AllocSizeInQwords;
} UNWIND_CODE_ALLOC_LARGE;
{% endhighlight %}
</td>
<td>
{% highlight c linenos %}
struct _UNWIND_CODE_ALLOC_SMALL {
    UBYTE CodeOffset;
    UBYTE UnwindOp                : 4;
    UBYTE AllocSizeInQwordsMinus8 : 4;
} UNWIND_CODE_ALLOC_SMALL;
{% endhighlight %}
</td>
</tr>
<tr>
<td rowspan="2">
{% highlight c linenos %}
/*(hdr.OpInfo & 0x1) == 0x1*/
#pragma pack(1)
struct _UNWIND_CODE_ALLOC_LARGE {
    UNWIND_CODE hdr;
    DWORD AllocSize;
} UNWIND_CODE_ALLOC_LARGE;
{% endhighlight %}
</td>
<td><span markdown="1">`.ALLOCSTACK 0xee0`</span></td>
</tr>
<tr>
<td><span markdown="1">`sub rsp, 0EE0h`</span></td>
</tr>
</table>

Instructions of this type allocate space for local variables and temporaries on stack. Notice that layout (and size!) of structure describing the corresponding unwind code may vary depending on the size of the region being allocated.

Going back to the subject of _alignment_, there are only two possible ways to meet the requirement one can concoct, the first of which consists in adding an extra (“dummy”) `push` instruction (if necessary) before pushing on stack arguments for a function and executing a `call` instruction. The second technique is to allocate a stack region that would fit all the parameters (and other temporaries such as the complex objects callees might return) for all the functions being called in advance, adding extra bytes (to ensure **_rsp_** is a multiple of 16) if need be. This way **_rsp_** is set in _prolog_ and it remains unchanged throughout the function’s body; meanwhile `mov` (with **_rsp_**-relative addressing) instructions are being used to initialize those arguments that are passed via stack (in place of the traditional `push` instructions). Nowadays 64-bit software (including, notably, Windows itself) seems to prefer the second approach. I came across this phenomenon when reverse-engineering _basesrv.dll_ as part of the _Abyss_ endeavor; anyone wishing for a real-life example should read [this section][abyss2cc] in one of the _Abyss_ posts.

{% capture alert-text %}
Did you ever notice the myriad of nautical idioms such as “to learn the ropes” or “to set sail” that came into our day-to-day life from sailing? I also noticed the term “pushing on stack” becoming somewhat idiomatic in nature. [Official documentation][mscc] refers to the process of initializing parameters passed via stack as “pushing on stack” irrespective of the actual instructions used to do it; even though, in the same document, “allocating a shadow store on stack” to keep the arguments (implying that they are to be initialized by `mov`s) is later mentioned. 
{% endcapture %}
{% include note-box.html text=alert-text %}

This method eliminates the need for a _frame pointer_ in many cases. Indeed, with **_rsp_** value staying fixed, all stack addresses can be easily computed relative to it at any point in the course of function’s lifetime. The reader, perhaps, remembers a mention of **_rsp_** becoming a possible “stable reference point” on _x64_ from the introduction and a promise to elaborate on it later. Well, there it was, fulfilled. 

However, a _frame pointer_ may still be useful in some situations and even necessary in others, hence the next set of instructions.

<table>
<tr><th colspan="2" markdown="1">**UWOP\_SET\_FPREG**</th></tr>
<tr>
<td rowspan="2">
{% highlight c linenos %}
typedef struct UNWIND_CODE UNWIND_CODE_SET_FPREG;
/*Register used as a frame pointer and its offset 
relative to rsp are recorded in 
UNWIND_INFO::FrameRegister and 
UNWIND_INFO::FrameOffset */
{% endhighlight %}
</td>
<td><span markdown="1">`.SETFRAME RBP, 0x80`</span></td>
</tr>
<tr><td><span markdown="1">`lea rbp, [rsp+80h]`</span></td></tr>
</table>

**_rbp_** is often used for the purpose of optimization; to this end, it is set to point somewhere between **_rsp_** and the beginning (base) of the stack frame so that addresses of some local variables could be calculated relative to **_rbp_** and some, relative to **_rsp_** (whichever is closer). It works since smaller offsets make shorter machine instructions that fit into cache much better. In this situation the _frame pointer_ is optional, however. Where one cannot do without it, is in functions that allocate space on their stacks dynamically (say, with `alloca()`).

Dynamic stack allocation means **_rsp_** changing its value by the amounts unknown at the time of compilation. While the function itself could manage (at the expense of efficiency) by using dynamic offsets, there is no way for the system’s stack unwinding procedure to deduce where the non-volatile registers are stored. “If space is dynamically allocated (alloca) in a function, then a nonvolatile register must be used as a frame pointer to mark the base of the fixed part of the stack and that register must be saved and initialized in the prolog.” the [documentation][msstack] states. 

**_rbp_** typically serves as a _frame pointer_, although I have seen other registers (**_r14_** and **_r15_**) appropriated for the purpose instead. 

With stack allocation instructions provided, an option of saving registers with `mov` instructions (rather than pushing them on stack) in prolog becomes available. Whichever tickles your fancy. Notice the difference in unwind code structure for instructions with long and short **_rsp_**-relative offsets.

<table>
<tr><th colspan="2" markdown="1">**UWOP\_SAVE\_NONVOL** and **UWOP\_SAVE\_NONVOL\_FAR**</th></tr>
<tr>
<td>
{% highlight c linenos %}
struct _UNWIND_CODE_SAVE_NONVOL {
    UBYTE CodeOffset;
    UBYTE UnwindOp : 4;
    UBYTE Reg      : 4;
    WORD  OffsetInQwords;
} UNWIND_CODE_SAVE_NONVOL;
{% endhighlight %}
</td>
<td>
{% highlight c linenos %}
#pragrma pack(1)
struct _UNWIND_CODE_SAVE_NONVOL_FAR {
    UBYTE CodeOffset;
    UBYTE UnwindOp : 4;
    UBYTE Reg      : 4;
    DWORD Offset;
} UNWIND_CODE_SAVE_NONVOL_FAR;
{% endhighlight %}
</td>
</tr>
<tr>
<td>
<span markdown="1">`.SAVEREG RDI, 0xf18`</span>
</td>
<td>
<span markdown="1">`mov qword ptr [rsp+0F18h], rdi`</span>
</td>
</tr>
</table>

A function can also save values of XMM registers in its prolog if it is so inclined.

<table>
<tr><th colspan="2" markdown="1">**UWOP\_SAVE\_XMM128** and **UWOP\_SAVE\_XMM128\_FAR**</th></tr>
<tr>
<td>
{% highlight c linenos %}
struct _UNWIND_CODE_SAVE_XMM128 {
    UBYTE CodeOffset;
    UBYTE UnwindOp : 4;
    UBYTE Reg      : 4;
    WORD  OffsetIn2Qwords;
} UNWIND_CODE_SAVE_XMM128;
{% endhighlight %}
</td>
<td>
{% highlight c linenos %}
#pragma pack(1)
struct _UNWIND_CODE_SAVE_XMM128_FAR {
    UBYTE CodeOffset;
    UBYTE UnwindOp : 4;
    UBYTE Reg      : 4;
    DWORD Offset;
} UNWIND_CODE_SAVE_XMM128_FAR;
{% endhighlight %}
</td>
</tr>
<tr>
<td>
<span markdown="1">`.SAVEXMM128 XMM0, 0x20`</span>
</td>
<td>
<span markdown="1">`movaps xmmword [rsp+20h], xmm0`</span>
</td>
</tr>
</table>

The remaining two types of unwind codes are not embodied by actual instructions, but rather serve to describe the function itself. Let us begin with the one that has been documented. 

<table>
<tr><th colspan="2" markdown="1">**UWOP\_PUSH\_MACHFRAME**</th></tr>
<tr>
<td>
{% highlight c linenos %}
typedef struct UNWIND_CODE UNWIND_CODE_PUSH_MACHFRAME;
/*(OnInfo & 0x1) == 0x1 for .PUSHFRAME 
with an error code*/
{% endhighlight %}
</td>
<td>
<span markdown="1">`.PUSHFRAME <code>`</span><br>
<span markdown="1">`.PUSHFRAME`</span>
</td>
</tr>
</table>

This unwind code signals that the function is an interrupt or exception handler and, as such, will have a so-called **_machine frame_** recorded on its stack prior to being called. Listed below are the steps a CPU running in 64-bit mode takes, according to Intel’s manual (pp. 195, 201), before passing control to a handler:
1. Current stack is switched to a kernel-mode stack if the interrupted code has been running in user mode.
2. The values **_ss_** and **_rsp_** had at the moment the interrupt occurred are pushed onto the (possibly, new) stack.
3. Current values of **_rflags_**, **_cs_**, and **_rip_** are saved on stack.
4. If the CPU is interrupted by an exception that comes with an error-code, the error code is recorded on stack.

The combined values of **_ss_**, **_rsp_**, **_rflags_**, **_cs_**, **_rip_** and the optional error code constitute a _machine frame_ (not to be confused with a _trap frame_ which is an entirely different beast); it is used by `iret` to switch back to a user-mode stack (if required) and restore the flags register before resuming the interrupted routine. Functions of this type need special treatment: it is crucial that before leaving the function, **_rsp_** is set to the value recorded in the _machine frame_; additionally, return address is not where one expects to find it – it is stored in the form of **_rip_** value (saved as a part of the _machine frame_) instead.

Why not peek inside some exception handler to see this unwind code being used in practice? I, personally, fancy examining a **_page fault_** handler. According to _Intel’s manual_, page fault is assigned an exception number `14` (`0xe`) and supplemented with an error code (a collection of flags characterizing the memory access operation that caused the exception).

{% include code-block-header.html title="WinDbg's Kernel Debugger" %}
{% highlight none linenos %}
kd> !idt

Dumping IDT: ffffa701af2cdc70

00:	fffff8019bfd2400 nt!KiDivideErrorFault
01:	fffff8019bfd2500 nt!KiDebugTrapOrFault
02:	fffff8019bfd26c0 nt!KiNmiInterrupt	Stack = 0xFFFFA701AF2CCBC0
03:	fffff8019bfd2a80 nt!KiBreakpointTrap
04:	fffff8019bfd2b80 nt!KiOverflowTrap
05:	fffff8019bfd2c80 nt!KiBoundFault
06:	fffff8019bfd2f00 nt!KiInvalidOpcodeFault
07:	fffff8019bfd3140 nt!KiNpxNotAvailableFault
08:	fffff8019bfd3200 nt!KiDoubleFaultAbort	Stack = 0xFFFFA701AF2C8BC0
09:	fffff8019bfd32c0 nt!KiNpxSegmentOverrunAbort
0a:	fffff8019bfd3380 nt!KiInvalidTssFault
0b:	fffff8019bfd3440 nt!KiSegmentNotPresentFault
0c:	fffff8019bfd3580 nt!KiStackFault
0d:	fffff8019bfd36c0 nt!KiGeneralProtectionFault
·0e·:	fffff8019bfd37c0 ·nt!KiPageFault·
[...]

kd> lmDvmnt
Browse full module list
start             end                 module name
fffff801`9be80000 fffff801`9c69f000   nt         (pdb symbols)          C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\sym\ntkrnlmp.pdb\D530E1D39E024EFF82EDB50767C75FBA1\·ntkrnlmp.pdb·
    Loaded symbol image file: ·ntkrnlmp.exe·
    Image path: ·ntkrnlmp.exe·
    Image name: ·ntkrnlmp.exe·
[...]
{% endhighlight %}

Now that we know the name a handler for page faults goes by in _global symbols_ and which module it lives in, we can find its RVA (with the help of [**pdbparse**][pdbparse]). The reason why we need a _symbol file_ to figure it out is because `KiPageFault` is not exported. 

{% highlight python linenos %}
Python 3.8.10 (default, Jun  2 2021, 10:49:15) 
[GCC 9.4.0] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import pdbparse
>>> pdb = pdbparse.parse("ntkrnlmp.pdb")
>>> itm = next(s for s in pdb.STREAM_GSYM.globals if "name" in dir(s)\
...  and "KiPageFault" == s.name)
>>> print(itm)
Container: 
    length = 26
    leaf_type = 4366
    symtype = 2
    offset = 1792192
    segment = 1
    name = u'KiPageFault' (total 11)
>>> hex(pdb.STREAM_SECT_HDR.sections[itm.segment - 1].VirtualAddress + itm.offset)
'0x1b68c0'
{% endhighlight %}

It would not be unreasonable to begin by making sure `KiPageFault` actually has the unwind code in question listed in its _exception directory_ entry. This is where [my extension](https://gist.github.com/Auscitte/1433a78d71c5f01c889243f45c04de01) for _pefile_ proves useful.

{% highlight python linenos %}
>>> import pefileseh
>>> pe = pefileseh.PEWithSEH('ntoskrnl.exe')
>>> e = next(e for e in pe.DIRECTORY_ENTRY_EXCEPTION if e.struct.BeginAddress == 0x1b68c0)
>>> print(e.struct); print(e.unwindinfo)
{% endhighlight %}

Running these commands results in the output below:

{% highlight none linenos %}
[RUNTIME_FUNCTION]
0x3B20BC   0x0   BeginAddress:                  ·0x1B68C0·
0x3B20C0   0x4   EndAddress:                    0x1B6E8D
0x3B20C4   0x8   UnwindData:                    0x3821F4
[UNWIND_INFO]
0x3821F4   0x0   Version:                       0x2
0x3821F4   0x0   Flags:                         0x0
0x3821F5   0x1   SizeOfProlog:                  0x10
0x3821F6   0x2   CountOfCodes:                  0x9
0x3821F7   0x3   FrameRegister:                 0x5
0x3821F7   0x3   FrameOffset:                   0x8
Flags: 
Unwind codes: EPILOG: size=0x2, offset from the end=-0x2; 
              EPILOG: size=0x2, offset from the end=-0x55; 
              EPILOG: size=0x2, offset from the end=-0x4d;
              .SETFRAME RBP, 0x80; 
              .ALLOCSTACK 0x158; 
              .PUSHREG RBP; 
              ·.PUSHFRAME <code>·

{% endhighlight %}

As expected, first among unwind codes (remember, they are stored in reverse order) is a `.PUSHFRAME` with an error code and, sure enough, this unwind code is not reflected in the prolog on account of machine frame being created by the CPU itself (the disassembly listing is obtained with [**Cutter**][cutter]):

{% highlight nasm linenos %}
0x1401b68c0      push rbp
0x1401b68c1      sub rsp, 0x158
0x1401b68c8      lea rbp, [rsp + 0x80]
0x1401b68d0      mov byte [rbp - 0x55], 1
0x1401b68d4      mov qword [rbp - 0x50], rax
0x1401b68d8      mov qword [rbp - 0x48], rcx
0x1401b68dc      mov qword [rbp - 0x40], rdx
0x1401b68e0      mov qword [rbp - 0x38], r8
0x1401b68e4      mov qword [rbp - 0x30], r9
0x1401b68e8      mov qword [rbp - 0x28], r10
0x1401b68ec      mov qword [rbp - 0x20], r11
[...]
{% endhighlight %}

One can easily follow the prolog, short as it is: **_rbp_** is saved on stack at `0x1401b68c0`, then a 344 byte-long storage space is allocated, also on stack, at `0x1401b68c1`, and, finally, at `0x1401b68d0`, a frame pointer is initialized.

{% capture alert-text %}
One might argue whether **_rbp_**, the way it is often used by MSVC nowadays, is still a **_frame pointer_** for it no longer points to the base of the frame; but a **_base pointer_** (another name the register often goes by), it is, decidedly, not. 
{% endcapture %}
{% include note-box.html text=alert-text %}

Prolog completed, the function goes on, as trap handlers do, to save a _trap frame_ on stack. A _trap frame_ is meant to preserve a thread context as it was at the point in time when the page fault occurred.

{% capture alert-text %}
To recap, CPU pushes a **_machine frame_** on stack before calling a **_frame function_** `KiPageFault`. We can call `KiPageFault` a **_frame function_** because it saves non-volatile registers on stack and calls another function, therefore, it it not a leaf function. `KiPageFault` allocates a region for its local variables within its **_stack frame_** and accesses them with the help of a **_frame pointer_**. This region is large enough to hold a **_trap frame_** that `KiPageFault` creates to record an execution context. Thereby, the **_machine frame_** resides outside of `KiPageFault`’s **_stack frame_** whereas the **_trap frame_** is located inside. Call me a paranoid, but it seems to me that systems engineers have conspired to confuse the hell out of us, innocent bystanders with a disassembler in hand, with their terminology. 
{% endcapture %}
{% include note-box.html text=alert-text %}

So far so good. In `KiPageFault` the `UWOP_PUSH_MACHFRAME` unwind code is used the way it is prescribed by the documentation. Having poked around in _ntoskrnl.exe_ a little more, I discovered another use case. Consider, for example, **_ZwClose()_**, one of the functions from _Zw\*_ family.

{% highlight none linenos %}
[IMAGE_EXPORT_DIRECTORY]
[...]
Ordinal      RVA         Name
2518       ·0x001A5C80·    ·ZwClose·
[...]
[RUNTIME_FUNCTION]
0x3B0298   0x0   BeginAddress:                  ·0x1A5C80·
0x3B029C   0x4   EndAddress:                    0x1A5C9F
0x3B02A0   0x8   UnwindData:                    0x380564
[UNWIND_INFO]
0x37DF64   0x0   Version:                       0x2
0x37DF64   0x0   Flags:                         0x0
0x37DF65   0x1   SizeOfProlog:                  0x1E
0x37DF66   0x2   CountOfCodes:                  0x3
0x37DF67   0x3   FrameRegister:                 0x0
0x37DF67   0x3   FrameOffset:                   0x0
Flags: 
Unwind codes: EPILOG: size=0x1, offset from the end=-0x1; ·.PUSHFRAME·
{% endhighlight %}

`ZwClose()` also has a `.PUSHFRAME` in its unwind info, even though it is not registered as an exception handler. Why is that? The answer can be found in the “System Service Dispatcher” chapter of _Windows Internals_. In user mode, system services are invoked by means of a `syscall` instruction (on _x64_) that elevates the CPU privilege level; since the latter is not needed if the processor already runs in kernel mode, Windows provides separate versions of _Windows Native API_ functions for drivers. These functions “build a fake interrupt stack (the stack that the CPU would generate after an interrupt) and call the `KiSystemService` directly, essentially emulating the CPU interrupt” the book says. Let us launch _Cutter_ once more and see for ourselves.

{% highlight nasm linenos %}
ZwClose ();
0x1401a5c80  mov rax, rsp
0x1401a5c83  cli
0x1401a5c84  sub rsp, 0x10       ; 16 bytes (the latter 8 are for storing ss)
0x1401a5c88  push rax            ; push old rsp
0x1401a5c89  pushfq              ; push rflags
0x1401a5c8a  push 0x10           ; 16 (in place of cs)
0x1401a5c8c  lea rax, [KiServiceLinkage] 
0x1401a5c93  push rax            ; rip
0x1401a5c94  mov eax, 0xf
0x1401a5c99  jmp KiServiceInternal
0x1401a5c9e  ret

;-- KiServiceLinkage:
0x1401ace90      ret
{% endhighlight %}

{% capture alert-text %}
First of all, people who got worried on seeing the `cli` instruction – do not. Your computer won’t become unresponsive (like a sullen teenager) on you as soon as your driver tries to close a handle – there is a matching `sti` instruction in `KiServiceInternal`. :-D
{% endcapture %}
{% include note-box.html text=alert-text %}

Indeed, `ZwClose()` seems to emulate the creation of a machine frame without an error code. It starts by allocating 16 bytes on stack, of which only the last 8 are included in the machine frame; these bytes are meant to hold the value of **_ss_**, but remain uninitialized. Allegedly, the first _QWORD_ is there to ensure the said frame is aligned to a 16-byte boundary (remember that `call` pushes a 64-bit return address on \[initially aligned\] stack). Values of **_rsp_** (the way it was on entering the function) and **_rflags_** are saved next. Shamefully, I do not have even the foggiest idea how 64-bit Windows 10 uses **_cs_**: whenever I check its value, it always seems to be `16` (`0x10`).

{% highlight none linenos %}
kd> r cs
cs=0010
{% endhighlight %}

And this is exactly the value recorded on stack by the instruction at `0x1401a5c8a` (so neither **_ss_** nor **_cs_** appear to have meaningful values). Finally, an address marked by label `KiServiceLinkage` is saved in place of **_rip_**. Residing at this address is a **_ret_** instruction. Once the system call is completed, the processor will restore **_rsp_** and **_rip_** from the values kept in the machine frame in an attempt to resume a non-existent interrupted routine. As a result, the return address pushed on stack by `call ZwClose` will be on top of the stack and **_ret_** – the next instruction to execute. It is a rather  neat trick, if you ask me.

Hopefully, this little tour of Windows' inner workings have demystified machine frames at least to some degree and we can safely move on to the next type of unwind codes.

<table>
<tr><th colspan="2" markdown="1">**UWOP\_EPILOG**</th></tr>
<tr>
<td>
{% highlight c linenos %}
/*(OpInfo & 0x1) == 1*/ 
struct _UNWIND_CODE_EPILOG_FIRST {
    UBYTE SizeAndOffset;
    UBYTE UnwindOp : 4;
    UBYTE OpInfo   : 4;
} UNWIND_CODE_EPILOG_FIRST;
{% endhighlight %}
</td>
<td>
{% highlight c linenos %}
/*(OpInfo & 0x1) == 0*/
struct _UNWIND_CODE_EPILOG_FIRST {
    UBYTE Size;
    UBYTE UnwindOp   : 4;
    UBYTE OpInfo     : 4;
    UBYTE OffsetLow;
    UBYTE Unused     : 4;
    UBYTE OffsetHigh : 4;
} UNWIND_CODE_EPILOG_FIRST;
{% endhighlight %}
</td>
</tr>
<tr>
<td>
{% highlight c linenos %}
struct _UNWIND_CODE_EPILOG {
    UBYTE OffsetLow;
    UBYTE UnwindOp   : 4;
    UBYTE OffsetHigh : 4;
} UNWIND_CODE_EPILOG;
{% endhighlight %}
</td>
</tr>
</table>

A stack unwinding procedure needs a way of distinguishing which part of the function has been interrupted by the exception: its body, prolog, or epilog. The former two are easy to tell apart thanks to the `SizeOfProlog` field of `UNWIND_INFO` structure; what is more, it is possible to determine which instructions have been executed (and, thus, require an “annulment”) so far with the help of instruction offsets given by the values of `UNWIND_CODE::SizeOfProlog` fields. In this respect, the stack unwinding procedure can be completely data-driven. 

The situation changes, however, when it comes to epilogs and, unless the epilog is an exact opposite of the prolog (i.e. there is one-to-one correspondence between the sequence of instructions in prolog and that in epilog, in reverse order), the unwinding procedure cannot avoid analyzing the machine code. For this reason, [Microsoft][prologepilog] is very specific about what is permitted in epilogs: 
>The epilog code must follow a strict set of rules for the unwind code to reliably unwind through exceptions and interrupts. These rules reduce the amount of unwind data required, because no extra data is needed to describe each epilog. Instead, the unwind code can determine that an epilog is being executed by scanning forward through a code stream to identify an epilog.

Nevertheless, an additional method for identifying epilogs, divulged only among friends, seems to exist. The unwind code `UWOP_EPILOG` appears in version **2** of `UNWIND_INFO` and, as of the time of writing, is undocumented. These codes specify offsets for all epilogs of a function. At least, this is what they are supposed to do if you believe the sources, scarce as they are. It sounds simple enough. 

The reality is a bit more complicated. `UWOP_EPILOG`s seem to mark only some instructions as belonging to an epilog; in particular, deallocating stack space (`add rsp, <const>`) and restoring register values by means of `mov` instructions are ignored while `pop <reg>` and `ret` are included in the epilog (we will see the examples later). In short, the compiler appears to draw the line at `add rsp, <const>` and whatever comes after it is considered a part of epilog. Now a few word on how epilog unwind codes are structured.

A function typically has one prolog only, situated at its entry point; as for epilog, there can be several of them – one for each exit point. Hence, there can be multiple `UWOP_EPILOG` unwind codes. Evidently, it is assumed that all the epilogs are identical or, at the very least, of the same length; thereby only the first epilog entry stores the length of epilogs (in bytes). Epilog offsets are given relative to the end of the function (that is, relative to `RUNTIME_FUNCTION::EndAddress`). 

When an epilog is located at the very end of the function, its offset and length are equal and no extra space is needed to store the offset. Even so, there must always be an even number of consecutive `UWOP_EPILOG` entries, the last one potentially unused, in the array of unwind codes. The unused entry will be zeroed out. Here is an example of such a function:

{% highlight none linenos %}
IoStartPacket (int64_t arg1, int64_t arg2, int64_t arg3, int64_t arg4);
0x14000·1220·      3 mov     rax, rsp
0x140001223      4 ·mov     qword [rax + 8], rbx·    ¡;reusing the space initially¡
0x140001227      4 ·mov     qword [rax + 0x10], rbp· ¡;meant to hold the arguments¡
0x14000122b      4 ·mov     qword [rax + 0x18], rsi·
0x14000122f      4 ·mov     qword [rax + 0x20], rdi·
0x140001233      2 ·push    r13·
0x140001235      2 ·push    r14·
0x140001237      2 ·push    r15·
0x140001239      4 ·sub     rsp, 0x20·
0x14000123d      3 mov     rsi, r9
[...] 
0x1400012a7      4 movzx   eax, r15b
0x1400012ab      4 mov     cr8, rax
0x1400012af      5 ·mov     rbx, qword [rsp + 0x40]· ¡;offsets differ from those in¡
0x1400012b4      5 ·mov     rbp, qword [rsp + 0x48]· ¡;prolog because RPS is¡ 
0x1400012b9      5 ·mov     rsi, qword [rsp + 0x50]· ¡;different (sub rsp, 0x20)¡
0x1400012be      5 ·mov     rdi, qword [rsp + 0x58]·
0x1400012c3      4 ·add     rsp, 0x20·
0x1400012c7      2 ·pop     r15· ¡;<--EPILOG starts here¡
0x1400012c9      2 ·pop     r14·
0x1400012cb      2 ·pop     r13·
0x1400012cd      1 ret
{% endhighlight %}

… and its entry in the exception directory:

{% highlight none linenos %}
[RUNTIME_FUNCTION]
0x39BA3C   0x0   BeginAddress:                  ·0x1220·
0x39BA40   0x4   EndAddress:                    0x12CE
0x39BA44   0x8   UnwindData:                    0x32236C
[UNWIND_INFO]
0x31FD6C   0x0   Version:                       ·0x2·
0x31FD6C   0x0   Flags:                         0x0
0x31FD6D   0x1   SizeOfProlog:                  0x1D
0x31FD6E   0x2   CountOfCodes:                  0xE
0x31FD6F   0x3   FrameRegister:                 0x0
0x31FD6F   0x3   FrameOffset:                   0x0
Flags: 
Unwind codes: ·EPILOG: size=0x7, offset from the end=-0x7·; 
             .SAVEREG RDI, 0x58; 
             .SAVEREG RSI, 0x50; 
             .SAVEREG RBP, 0x48; 
             .SAVEREG RBX, 0x40; 
             .ALLOCSTACK 0x20; 
             .PUSHREG R15; 
             .PUSHREG R14; 
             .PUSHREG R13 
{% endhighlight %}

In compliance with the earlier remark, the unwind code for the epilog only includes a sequence of `pop`s and a terminating `ret` instruction: seven bytes in total (for comparison, instructions constituting prolog and epilog are highlighted in the assembly listing). Since the epilog is at the very end of the function, the size is also its offset. Physically, that leaves one slot for the epilog unwind codes unoccupied. My implementation does not show empty unwind codes, but one can still ascertain their presence by consulting **dumpbin**. 

{% highlight none linenos %}
0000003C 0000·1220· 000012CE 0032236C  ·IoStartPacket·
    Unwind version: 2
    Unwind flags: None
    Size of prologue: 0x1D
    Count of codes: 14
    Unwind codes:
      07: EPILOG, flags = 0x1, size = 0x7
      00: ·EPILOG, offset from end = 0x0·
      1D: SAVE_NONVOL, register=rdi offset=0x58
      1D: SAVE_NONVOL, register=rsi offset=0x50
      1D: SAVE_NONVOL, register=rbp offset=0x48
      1D: SAVE_NONVOL, register=rbx offset=0x40
      1D: ALLOC_SMALL, size=0x20
      19: PUSH_NONVOL, register=r15
      17: PUSH_NONVOL, register=r14
      15: PUSH_NONVOL, register=r13
{% endhighlight %}

Compilers tend to rearrange basic blocks (of their internal control flow graphs) so as to ensure optimal performance; as a result, the epilog might end up residing at an arbitrary location within the function. In this case the epilog offset is stored separately (hence the two different versions of `UNWIND_CODE_EPILOG_FIRST` structure). Below is an example illustrating this case:

{% highlight none linenos %}
PspLockQuotaExpansion (uint32_t arg1, int64_t arg2);
0x1400·11738·      2 ·push rbx·
0x14001173a      4 ·sub rsp, 0x20·
0x14001173e      3 cmp dword [rcx], 0
0x140011741      3 mov rbx, rdx
0x140011744      2 je 0x140011757
0x140011746      4 add rcx, 0x10
0x14001174a      5 call KeAcquireSpinLockRaiseToDpc
0x14001174f      2 mov byte [rbx], al
0x140011751      4 ·add rsp, 0x20·
0x140011755      1 ·pop rbx· ¡;<--EPILOG starts here¡
0x140011756      1 ret
0x140011757      9 mov rax, qword gs:[0x188]
0x140011760      3 mov byte [rdx], 0
0x140011763      7 dec word [rax + 0x1e6]
0x14001176a      2 xor edx, edx
0x14001176c      4 add rcx, 0x10
0x140011770      5 call ExAcquirePushLockExclusiveEx
0x140011775      2 jmp 0x140011751
{% endhighlight %}

It is not easy to spot an epilog in a homogeneous fabric of instructions, but it is there, at an RVA of `0x11751`. Following the logic, the epilog unwind code should count two instructions only: `pop rbx` and `ret` –  giving an epilog 2 bytes in length located at an offset of `(0x11775 + 2) – 0x11755 = 0x22` relative to the end of the function. Right? Let us see… 

{% highlight none linenos %}
[RUNTIME_FUNCTION]
0x39C924   0x0   BeginAddress:                  ·0x11738·
0x39C928   0x4   EndAddress:                    0x11777
0x39C92C   0x8   UnwindData:                    0x32438C
[UNWIND_INFO]
0x321D8C   0x0   Version:                       ·0x2·
0x321D8C   0x0   Flags:                         0x0
0x321D8D   0x1   SizeOfProlog:                  0x6
0x321D8E   0x2   CountOfCodes:                  0x4
0x321D8F   0x3   FrameRegister:                 0x0
0x321D8F   0x3   FrameOffset:                   0x0
Flags: 
Unwind codes: ·EPILOG: size=0x2, offset from the end=-0x22·; 
              .ALLOCSTACK 0x20; 
              .PUSHREG RBX
{% endhighlight %}

We appear to be correct in our calculations. For the sake of completeness, I am including _dumbin_’s output as well:

{% highlight none linenos %}
00000F24 000·11738· 00011777 0032438C  ·PspLockQuotaExpansion·
    Unwind version: 2
    Unwind flags: None
    Size of prologue: 0x06
    Count of codes: 4
    Unwind codes:
      02: ·EPILOG, flags = 0x0, size = 0x2·
      22: ·EPILOG, offset from end = 0x22·
      06: ALLOC_SMALL, size=0x20
      02: PUSH_NONVOL, register=rbx
{% endhighlight %}

The complexity of accommodating offsets and sizes in `UNWIND_CODE` pertains solely to the first _EPILOG_ entry; subsequent entries contain offsets only. To people who found matching epilogs in assembly listings to unwind codes in exception directory entertaining, I am giving yet another example. The pleasure is all mine.

{% highlight none linenos %}
(loc) LdrpHandleInvalidUserCallTarget (int64_t arg1, int64_t arg2, int64_t arg3, int64_t arg4);
0x1800·8a890·      2 ·push r11·
0x18008a892      2 ·push r10·
0x18008a894      2 ·push r9·
0x18008a896      2 ·push r8· 
0x18008a898      1 ·push rcx· 
0x18008a899      1 ·push rdx·
0x18008a89a      1 ·push rax·
0x18008a89b      7 ·sub rsp, 0x80·
0x18008a8a2      5 ·movaps xmmword [rsp + 0x20], xmm0·
0x18008a8a7      5 ·movaps xmmword [rsp + 0x30], xmm1·
0x18008a8ac      5 ·movaps xmmword [rsp + 0x40], xmm2·
0x18008a8b1      5 ·movaps xmmword [rsp + 0x50], xmm3·
0x18008a8b6      5 ·movaps xmmword [rsp + 0x60], xmm4·
0x18008a8bb      5 ·movaps xmmword [rsp + 0x70], xmm5· ¡;prolog ends¡
0x18008a8c0      3 mov rcx, rax
0x18008a8c3      5 call RtlpHandleInvalidUserCallTarget
0x18008a8c8      5 ·movaps xmm3, xmmword [rsp + 0x50]· ¡;epilog begins¡
0x18008a8cd      5 ·movaps xmm2, xmmword [rsp + 0x40]·
0x18008a8d2      5 ·movaps xmm1, xmmword [rsp + 0x30]·
0x18008a8d7      5 ·movaps xmm0, xmmword [rsp + 0x20]· ¡;epilog splits in two¡
0x18008a8dc      8 mov r10, qword [rsp + 0xa8]
0x18008a8e4      3 test r10, r10
0x18008a8e7      2 je 0x18008a8fe 
0x18008a8e9      7 ·add rsp, 0x80· ¡;epilog #1 continues¡
0x18008a8f0      1 ·pop rax· ¡; EPILOG: 0x8a8f0 = 0x8A91B - 0x2B¡
0x18008a8f1      1 ·pop rdx·
0x18008a8f2      1 ·pop rcx·
0x18008a8f3      2 ·pop r8·
0x18008a8f5      2 ·pop r9·
0x18008a8f7      2 ·pop r10·
0x18008a8f9      2 ·pop r11·
0x18008a8fb      3 jmp rax
0x18008a8fe      5 ·movaps xmm5, xmmword [rsp + 0x70]· ¡;epilog #2 continues¡
0x18008a903      5 ·movaps xmm4, xmmword [rsp + 0x60]·
0x18008a908      7 ·add rsp, 0x80·
0x18008a90f      1 ·pop rax· ¡; EPILOG: 0x8a90f = 0x8A91B - 0xC¡
0x18008a910      1 ·pop rdx·
0x18008a911      1 ·pop rcx·
0x18008a912      2 ·pop r8·
0x18008a914      2 ·pop r9·
0x18008a916      2 ·pop r10·
0x18008a918      2 ·pop r11·
0x18008a91a      1 ret
{% endhighlight %}

It is a rather curious case. Look! The epilog begins by restoring the value of **_xmm3_** (at `0x18008a8c8`), then after a shot interference from some other code, resumes its execution, splitting into two nearly identical copies: one starting at `0x18008a8e9` and another, at `0x18008a8fe`. For some reason, `LdrpHandleInvalidUserCallTarget` decided not to restore the values of **_xmm4_** and **_xmm5_** to their pre-call states before passing control to a function whose address had been stored in **_rax_**. If the prior experience is something to go by, the exception directory entry for `LdrpHandleInvalidUserCallTarget` should hold two epilog unwind codes, both marking an RVA of `pop rax` as their starting points: namely, `0x2b = (0x8a91a + 1) - 0x8a8f0` and `0xc = (0x8a91a + 1) – 0x8a90f`. The offset of the second epilog, given its location, will also be its size.

{% highlight none linenos %}
[RUNTIME_FUNCTION]
0x15D224   0x0   BeginAddress:                  ·0x8A890·
0x15D228   0x4   EndAddress:                    0x8A91B
0x15D22C   0x8   UnwindData:                    0x13FD20
    [UNWIND_INFO]
    0x13FD20   0x0   Version:                       ·0x2· 
    0x13FD20   0x0   Flags:                         0x0
    0x13FD21   0x1   SizeOfProlog:                  0x30
    0x13FD22   0x2   CountOfCodes:                  0x16
    0x13FD23   0x3   FrameRegister:                 0x0
    0x13FD23   0x3   FrameOffset:                   0x0
    Flags: 
    Unwind codes: ·EPILOG: size=0xc, offset from the end=-0xc·; 
                  ·EPILOG: size=0xc, offset from the end=-0x2b·; 
                  .SAVEXMM128 XMM5, 0x70; 
                  .SAVEXMM128 XMM4, 0x60; 
                  .SAVEXMM128 XMM3, 0x50; 
                  .SAVEXMM128 XMM2, 0x40; 
                  .SAVEXMM128 XMM1, 0x30; 
                  .SAVEXMM128 XMM0, 0x20; 
                  .ALLOCSTACK 0x80; 
                  .PUSHREG RAX; 
                  .PUSHREG RDX; 
                  .PUSHREG RCX; 
                  .PUSHREG R8; 
                  .PUSHREG R9; 
                  .PUSHREG R10; 
                  .PUSHREG R11
{% endhighlight %}

The epilog codes are exactly as we expected to find them. Note, however, that the first epilog ends in a 3 byte-long `jmp rax` instruction, not the usual 1-byte `ret`, therefore, only the first byte of `jmp rax` is included in the epilog. :-) It makes one wonder: should an exception be thrown at the `jmp rax` instruction, will it be deemed as occurring inside the epilog or body of the function? I will leave the speculations for another time.

As usual, I am including an output from _dumpbin_. 

{% highlight none linenos %}
00005424 000·8A890· 0008A91B 0013FD20  ·LdrpHandleInvalidUserCallTarget·
    Unwind version: 2
    Unwind flags: None
    Size of prologue: 0x30
    Count of codes: 22
    Unwind codes:
      0C: ·EPILOG, flags = 0x1, size = 0xC·
      2B: ·EPILOG, offset from end = 0x2B·
      30: SAVE_XMM128, register=xmm5 offset=0x70
      2B: SAVE_XMM128, register=xmm4 offset=0x60
      26: SAVE_XMM128, register=xmm3 offset=0x50
      21: SAVE_XMM128, register=xmm2 offset=0x40
      1C: SAVE_XMM128, register=xmm1 offset=0x30
      17: SAVE_XMM128, register=xmm0 offset=0x20
      12: ALLOC_SMALL, size=0x80
      0B: PUSH_NONVOL, register=rax
      0A: PUSH_NONVOL, register=rdx
      09: PUSH_NONVOL, register=rcx
      08: PUSH_NONVOL, register=r8
      06: PUSH_NONVOL, register=r9
      04: PUSH_NONVOL, register=r10
      02: PUSH_NONVOL, register=r11
{% endhighlight %}

{% capture alert-text %}
In the beginning I briefly mentioned the lack of source material on the topic. In fact, the only explanation, detailed enough to base an implementation on, came from this [article][unwindepilog2]. I believe it to be a translation into English done by either AI or a person not familiar with the subject due to figure captions in Cyrillic script, unusual turn of phrase, and mysterious terminology. What do you suppose a “promotion handler” in “the untwisted function has a promotion handler” to be? Nevertheless, having found the paper immensely useful, I decided to track down the original using the image files in it. The search yielded two versions of the same article: one located [here][unwindepilog1.5] and another one, [here][unwindepilog1]. The latter contained a line that Google would happily translate for you as “Article by Anatoly Mikhailov”, so Anatoly Mikhailov must be the author.
 
Another kind of sorcery handy in exploring the Undocumented came in the form of a Microsoft’s own utility – **dumpbin**. When launched with `/UNWINDINFO` parameter, it will dump the exception directory entries along with the unwind codes. 
{% endcapture %}
{% include note-box.html text=alert-text %}

On this note, I conclude this unduly lengthy treatise on the subject of unwind codes. 

### Chained Functions

Sometimes compilers redistribute machine code within the binary image, presumably, in such a way that the branches executed most often end up close together. Thus, blocks of code from multiple functions may be intertwined. I describe the phenomenon and propose a method for listing all the separated code blocks for any function (32- or 64-bit) in one of my earlier [posts][sep]. Here is an example borrowed from there:

{% highlight bash linenos %}
$ python3 pdb_list_code_blocks.py -p basesrv.pdb -m basesrv.dll -n ServerDllInitialization
Function start: 0x180001680
Function end: 0x1800023f2 ( length =  3442 )
Separated blocks of code:
         Block start: 0x180004d06
         Block end: 0x180004f8a ( length =  644 )
{% endhighlight %}

_basesrv.dll_ is loaded at its preferred base address of `0x180000000`; in terms RVAs, the blocks  of code constituting `ServerDllInitialization()`, hereby, are: `0x1680-0x23f2` and `0x4d06-0x4f8a`. Notice a gap between the `0x23f2` and `0x23f2` relative addresses; as pointed out [here][abyss2frag], “the body of `ServerDllInitialization()` is fragmented with the instructions from other functions, `BaseSrvInitializeIniFileMappings()` and `BaseSrvSaveIniFileMapping()`, squeezed in between its code blocks”. 

Now let us attempt obtaining the same list of code fragments by means of our extended pefile.

{% highlight python linenos %}
>>> import pefileseh
>>> pe = pefileseh.PEWithSEH('basesrv.dll')
>>> es = [ e.struct.dump() + e.unwindinfo.dump() for e in pe.DIRECTORY_ENTRY_EXCEPTION\
... if e.struct.BeginAddress == 0x1680 or\
... "FunctionEntry" in dir(e.unwindinfo) and e.unwindinfo.FunctionEntry == 0x1680]
>>> print(*['\n'.join(e) for e in es ], sep = '\n\n')
{% endhighlight %}

This set of commands produces the output below.

{% include code-block-header.html title="ServerDllInitialization()'s Exception Directory" %}
{% highlight none linenos %}
[RUNTIME_FUNCTION]
0xEC30     0x0   BeginAddress:                  ·0x1680·
0xEC34     0x4   EndAddress:                    0x17BE
0xEC38     0x8   UnwindData:                    0xE0F8
[UNWIND_INFO]
0xD0F8     0x0   Version:                       0x1
0xD0F8     0x0   Flags:                         0x3
0xD0F9     0x1   SizeOfProlog:                  0x28
0xD0FA     0x2   CountOfCodes:                  0x7
0xD0FB     0x3   FrameRegister:                 0x0
0xD0FB     0x3   FrameOffset:                   0x0
0xD10C     0x14  ExceptionHandler:              0x47C0
Flags: UNW_FLAG_EHANDLER, UNW_FLAG_UHANDLER
Unwind codes: .ALLOCSTACK 0xee0; .PUSHREG R15; .PUSHREG R12; .PUSHREG RSI; .PUSHREG RBX; .PUSHREG RBP

[RUNTIME_FUNCTION]
0xEC3C     0x0   BeginAddress:                  0x17BE
0xEC40     0x4   EndAddress:                    0x233D
0xEC44     0x8   UnwindData:                    0xE114
[UNWIND_INFO]
0xD114     0x0   Version:                       0x1
0xD114     0x0   Flags:                         0x4
0xD115     0x1   SizeOfProlog:                  0x23
0xD116     0x2   CountOfCodes:                  0x6
0xD117     0x3   FrameRegister:                 0x0
0xD117     0x3   FrameOffset:                   0x0
0xD124     0x10  FunctionEntry:                 ·0x1680·
Flags: ·UNW_FLAG_CHAININFO·
Unwind codes: .SAVEREG R14, 0xf28; .SAVEREG R13, 0xf20; .SAVEREG RDI, 0xf18

[RUNTIME_FUNCTION]
0xEC48     0x0   BeginAddress:                  0x233D 
0xEC4C     0x4   EndAddress:                    0x235B
0xEC50     0x8   UnwindData:                    0xE130
[UNWIND_INFO]
0xD130     0x0   Version:                       0x1
0xD130     0x0   Flags:                         0x4
0xD131     0x1   SizeOfProlog:                  0x0 
0xD132     0x2   CountOfCodes:                  0x0 
0xD133     0x3   FrameRegister:                 0x0
0xD133     0x3   FrameOffset:                   0x0 
0xD134     0x4   FunctionEntry:                 ·0x1680· 
Flags: ·UNW_FLAG_CHAININFO·
Unwind codes: 

[RUNTIME_FUNCTION]
0xEC54     0x0   BeginAddress:                  0x235B 
0xEC58     0x4   EndAddress:                    0x23F2
0xEC5C     0x8   UnwindData:                    0xE140
[UNWIND_INFO]
0xD140     0x0   Version:                       0x1
0xD140     0x0   Flags:                         0x4 
0xD141     0x1   SizeOfProlog:                  0x0 
0xD142     0x2   CountOfCodes:                  0x6 
0xD143     0x3   FrameRegister:                 0x0 
0xD143     0x3   FrameOffset:                   0x0 
0xD150     0x10  FunctionEntry:                 ·0x1680· 
Flags: ·UNW_FLAG_CHAININFO·
Unwind codes: .SAVEREG R14, 0xf28; .SAVEREG R13, 0xf20; .SAVEREG RDI, 0xf18

[RUNTIME_FUNCTION]
0xEE4C     0x0   BeginAddress:                  0x4D06 
0xEE50     0x4   EndAddress:                    0x4F8A 
0xEE54     0x8   UnwindData:                    0xE15C 
[UNWIND_INFO]
0xD15C     0x0   Version:                       0x1 
0xD15C     0x0   Flags:                         0x4 
0xD15D     0x1   SizeOfProlog:                  0x0 
0xD15E     0x2   CountOfCodes:                  0x6 
0xD15F     0x3   FrameRegister:                 0x0
0xD15F     0x3   FrameOffset:                   0x0 
0xD16C     0x10  FunctionEntry:                 ·0x1680· 
Flags: ·UNW_FLAG_CHAININFO·
Unwind codes: .SAVEREG R14, 0xf28; .SAVEREG R13, 0xf20; .SAVEREG RDI, 0xf18
{% endhighlight %}

Easily discernible in the output are the primary `RUNTIME_FUNCTION` record for `ServerDllInitialization()`, with its exception and unwind handlers specified, and the separated block `0x4D06-0x4D06` (listed last), the latter having its `Flags` set to `UNW_FLAG_CHAININFO` to indicate it being a part of a chain of code fragments. Equally easily, however, we can see that the body of the function was further subdivided into a set of contiguous blocks: `0x1680-0x17BE`, `0x17BE-0x233D`, `0x233D-0x235B`, `0x235B-0x23F2`. Every one of these fragments has `FunctionEntry` equal to `0x1680`, the start address (RVA) of `ServerDllInitialization()`. Microsoft reveals the reason behind such an organization [here][msseh] : 
>You can also use chained info to group volatile register saves. The compiler may delay saving some volatile registers until it is outside of the function entry prolog. You can record them by having primary unwind info for the portion of the function before the grouped code, and then setting up chained info with a non-zero size of prolog, where the unwind codes in the chained info reflect saves of the nonvolatile registers. In that case, the unwind codes are all instances of UWOP_SAVE_NONVOL. A grouping that saves nonvolatile registers by using a PUSH or modifies the RSP register by using an additional fixed stack allocation is not supported.

Indeed, the chained fragments (all, but the first one) have `.SAVEREG`s only in their lists of unwind codes.

Summing it all up, the body of a function can be divided into code fragments, each with its own `RUNTIME_FUNCTION` structure in _exception directory_. Of these, only the first one can have `UNW_FLAG_EHANDLER` or `UNW_FLAG_UHANDLER` flags set; the rest cannot specify exception handlers of their own and must use the `UNW_FLAG_CHAININFO` flag to signal belonging to a chain. In addition, for all but the first blocks, the field `FunctionEntry` must be set to the `StartAddress` of the function. These fragments may still have their own unwind codes, but there is restriction placed on the type of codes they can use.

Before moving on, I would like to add a couple more remarks on the subject. Rumor has it, there is an alternative, more efficient but undocumented, way of specifying that a `RUNTIME_FUNCTION` is a part of some chain. It is applicable only if the code block does not have unwind codes; in this case the `UNWIND_INFO` structure carries no useful information and can be done away with. Since `UNWIND_INFO`s are required to be _DWORD_-aligned, the lowest bit of `UnwindData` in  `RUNTIME_FUNCTION` may be used as an indicator that this field (when AND’ed with the mask `~0x1`) gives an RVA of another `RUNTIME_FUNCTION` (the first one in the chain) instead of unwind data. Both, Ken Johnson and Matt Miller, mention this special case. That said, I have not encountered a binary that would use this feature yet.

{% capture alert-text %}
A word of caution to anyone reading this material with a view to implementing their own parser for exception directories. There seems to be a little inaccuracy in Microsoft’s [documentation][msseh]. Therein, it is implied that `FunctionEntry` should point to the primary `RUNTIME_FUNCTION` when, in practice, it usually contains an RVA of the function itself. I am copypasting pseudocode from said documentation in order to explain what I mean: 

`PRUNTIME_FUNCTION primaryUwindInfo = (PRUNTIME_FUNCTION)&(unwindInfo->UnwindCode[( unwindInfo->CountOfCodes + 1 ) & ~1]);`

I notified them about the \[possible\] error, but revising the docs may take some time.
{% endcapture %}
{% include note-box.html text=alert-text %} 

## Implementation Details

A reasonably comprehensive overview of _exception directory_’s structure and applications having been provided, notes on implementing a parser for it are in order.

There are two types of data containers found in _pefile_: a generic `DataContainer`, used to store an arbitrary collection of attributes (no strings attached), and `Structure` that comes with the functionality for specifying data format in declarative form, generating a textual representation for the structure, and serialization to/deserialization from a binary stream. Another feature one would like to utilize is patching; _pefile_ maintains a list of `Structure` instances and, if requested, all modifications done to them might be written back to the _PE+_ image.

In order to leverage the existing functionality, class `Structure` will underlie the representations of `RUNTIME_FUNCTION`, `UNWIND_INFO`, and derivatives of `UNWIND_CODE`. Internally, `Structure` keeps a list (named `__keys__`) of fields that make up the structure it embodies and a format string for packing and unpacking this structure by means of the _struct_ library. For example, in case when a `Structure` instance represents a `RUNTIME_FUNCTION` its `__keys__` and `__format__` will be initialized to `__keys__ = [ [‘BeginAddress’], [‘EndAddress’], [‘UnwindData’] ]` (the nested lists are there to store aliases for fields of the structure as part of \[partial\] support for _C_ unions) and `__format__ = ‘<III’`. 

The reader steeped in _python_ will know that _struct_ does not provide any means to handle bitfields, so I have decided on implementing the missing functionality in a subclass of `Structure`, unimaginatively named `StructureWithBitfields`. An instance of `StructureWithBitfields` needs two lists of field names instead of one: the first one, to store bitfields in their compound form and another, to enumerate all the subfields in a bitfield by name. For `UNWIND_CODE`, the said lists will be `[ [‘CodeOffset’], [‘~CodeOffsetOpInfo’] ]` and `[ [‘CodeOffset’], [‘CodeOffset’], [‘OpInfo’] ]` respectively. By switching between the lists, it is possible to reuse the implementations of packing/unpacking and conversion to a human-readable text format from the parent class, thereby ensuring these tasks are accomplished in a uniform fashion across the library. A notable disadvantage of this solution is that `Structure` and `StructureWithBitfields` become closely coupled and, as such, must be maintained (i.e. modified) together. 

Adding a second list leads to memory overhead that, in most cases, is insignificant. The good fortune is a byproduct (or rather serendipity) of LRU caching enabled for `set_format()`, the function that generates `__keys__` and `__format__` (and other auxiliary data structures). As of version _2021.5.24_, _pefile_ applies shallow copying to whatever `set_format()` returns, resulting in the upper-most tuple only being duplicated. Consequently, `__keys__` is shared among all the `Structures` with the same format, which is reasonable and beneficial from the performance standpoint. I applied the same technique to `StructureWithBitfields` (see function `set_bitfields_format()`). Of course, caching is done only for _python 3_, but _python 2_ is rarely used these days. 

When it comes to `UNWIND_INFO`, presence of bitfields is not the only complication. The structure also contains an array of `UNWIND_INFO` structures of variable length and optional fields thereby necessitating another level of inheritance (that is, further subclassing). `UnwindInfo` is unpacked in two stages, first of which determines the size of the structure and the second, completes the deserialization. 

The same technique is applied to unwind codes. As explained in the [Unwind Codes](#unwind-codes) section, unwind codes of different types, although varying in their layouts in memory, share the same header, `UNWIND_CODE`. `UNWIND_CODE::UnwindOp` identifies the type of unwind code and `UnwindOp::OpInfo` further particularizes its structure. The deserialization routine begins by unpacking the header, which is then, following the principles of the _Factory Method_ design pattern, passed to a factory of unwind codes. The factory creates an instance of a class, suitable for the given header, and this newly created object, in turn, deserializes itself. 

For summary, I am including a conceptual UML class diagram created with [YUML](https://yuml.me). The diagram is “conceptual” in the sense that its comprehensiveness and accuracy have been sacrificed in favor of readability. 

{% include orig-size-centered-fig.html filename="pefileseh_class_diagram.png" alt="pefileseh Class Diagram" %}

The implementation itself is not “conceptual”, however, and the python script, in all its completeness, can be found [here](https://gist.github.com/Auscitte/1433a78d71c5f01c889243f45c04de01).

## Conclusion

This post aimed to provide the necessary background material to anyone interested in taking advantage of SEH-related meta-data available in 64-bit _PE+_ binaries (or anyone intending to use or improve my implementation of exception directory parser). 

While most of the information presented here could be found elsewhere, the reader, hopefully, benefited from the relatively in-depth treatment of aspects (e.g. machine frames or epilog unwind codes) that were either undocumented or not discussed in detail before. 

-- Ry Auscitte

## References

1. Ero Carrera, [pefile][pefile] : a Python module to read and work with PE (Portable Executable) files
2. [Intel® 64 and IA-32 Architectures Software Developer’s Manual][intel], Volume 3A: System Programming Guide, Part 1
3. Ken Johnson, [Programming against the x64 exception handling support][x64sehskywing], Nynaeve: Adventures in Windows debugging and reverse engineering
4. Matt Miller, [Improving Automated Analysis of Windows x64 Binaries][x64scape], Uninformed, June 2006
5. Andrea Allievi, [Exceptional behavior: the Windows 8.1 X64 SEH Implementation][x64seh8.1]
6. [Exceptional Behavior - x64 Structured Exception Handling][osrseh], OSR Online. The NT Insider, Vol 13, Issue 3, 23 June 2006
7. Matt Pietrek, [A Crash Course on the Depths of Win32 Structured Exception Handling][x86seh], Microsoft Systems Journal, January 1997
8. Mark E. Russinovich, David A. Solomon, and Alex Ionescu. (2012), Exception Dispatching, in Windows Internals, Part 1: Covering Windows Server 2008 R2 and Windows 7 (6th. ed.). Microsoft Press, USA.
9. [x64 exception handling][msseh], in x64 Software Conventions, Microsoft Docs
10. Ken Johnson, [Frame pointer omission (FPO) optimization and consequences when debugging][FPO], Nynaeve: Adventures in Windows debugging and reverse engineering
11. [Chained unwind info structures][chained], x64 exception handling, Microsoft Docs
12. Ry Auscitte, [A Quick Note: Locating All Code Blocks Belonging to a (Fragmented) Function with pdbparse][sep]
13. Ry Auscitte, [Decompilers: Comparative Analysis and Outcome][abyss2frag], in Bringing My OS Back from the Abyss: Reversing basesrv.dll Initialization Procedure (Part 2)
14. Ry Auscitte, [Calling Convention In 64-bit Windows][abyss2cc] in Bringing My OS Back from the Abyss: Reversing basesrv.dll Initialization Procedure (Part 2)
15. [x64 prolog and epilog][prologepilog], in x64 Software Conventions, Microsoft Docs
16. Rich Skorski, [In-depth: Windows x64 ABI: Stack frames][abiframes]
17. [x64 calling convention][mscc] in x64 Software Conventions, Microsoft Docs
18. [x64 stack usage][msstack] in x64 Software Conventions, Microsoft Docs
19. Brendan Dolan-Gavitt, [pdbparse][pdbparse] : GPL-licensed library for parsing Microsoft PDB files
20. [Cutter][cutter]: a reverse-engineering platform
21. Mark E. Russinovich, David A. Solomon, and Alex Ionescu. (2012), System Service Dispatching, in Windows Internals, Part 1: Covering Windows Server 2008 R2 and Windows 7 (6th. ed.). Microsoft Press, USA.
22. Anatoly Mikhailov, [Exceptions on Windows x64. How it works. Part 2. (original)][unwindepilog1] 
23. Anatoly Mikhailov, [Exceptions on Windows x64. How it works. Part 2. (translated)][unwindepilog2]
24. Ry Auscitte, [Bringing My OS Back from the Abyss : Windows Crash Dump Analysis (Part 1)][abyss]


[pefile]: https://github.com/erocarrera/pefile
[intel]: https://software.intel.com/content/www/us/en/develop/articles/intel-sdm.html
[x64sehskywing]: http://www.nynaeve.net/?p=113
[x64scape]: http://www.uninformed.org/?v=4&a=1&t=sumry
[x64seh8.1]: https://blog.talosintelligence.com/2014/06/exceptional-behavior-windows-81-x64-seh.html 
[osrseh]: https://www.osronline.com/article.cfm%5Earticle=469.htm
[x86seh]: https://bytepointer.com/resources/pietrek_crash_course_depths_of_win32_seh.htm
[msseh]: https://docs.microsoft.com/en-us/cpp/build/exception-handling-x64
[FPO]: http://www.nynaeve.net/?p=97
[chained]: https://docs.microsoft.com/en-us/cpp/build/exception-handling-x64#chained-unwind-info-structures
[sep]: {%post_url 2020-12-01-Code-Fragments-With-Pdbparse %}
[abyss2frag]: {{ site.baseurl }}/systems-blog/ServerDllInitialization-reversing#decompilers-comparative-analysis-and-outcome
[abyss2cc]: {{ site.baseurl }}/systems-blog/ServerDllInitialization-reversing#calling-convention-in-64-bit-windows
[prologepilog]: https://docs.microsoft.com/en-us/cpp/build/prolog-and-epilog
[abiframes]: https://www.gamasutra.com/view/news/178446/Indepth_Windows_x64_ABI_Stack_frames.php
[mscc]: https://docs.microsoft.com/en-us/cpp/build/x64-calling-convention
[msstack]: https://docs.microsoft.com/en-us/cpp/build/stack-usage
[pdbparse]: https://github.com/moyix/pdbparse
[cutter]: https://cutter.re/
[unwindepilog1]: https://www.aladdin-rd.ru/company/pressroom/articles/isklucenia_v_windows_x64_kak_eto_rabotaet_cast_2
[unwindepilog1.5]: https://habr.com/ru/company/aladdinrd/blog/322956/
[unwindepilog2]: https://sudonull.com/post/72973-Exceptions-on-Windows-x64-How-it-works-Part-2-Company-blog-Aladdin-RD
[abyss]: {% post_url 2019-02-06-Crash-Dump-Analysis %}
