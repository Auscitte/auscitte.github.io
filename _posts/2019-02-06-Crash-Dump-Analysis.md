---
layout: post
title: Bringing My OS Back from the Abyss &#58 Windows Crash Dump Analysis (Part 1)
author: Ry Auscitte
category: systems blog
comments: true
description: A Windows crash dump analysis walkthrough
tags:
    - Windows 10
    - WinDbg
    - crash dump
---

## Introduction

So I broke my 64-bit Windows 10 system by accidentally tapping on a wrong menu item... All of you, no doubt, have encountered countless times and are well familiar with boot menus such as this one:

{% include orig-size-centered-fig.html filename="Boot_menu.png" alt="A boot menu" %}

Result of this unfortunate choice was that Windows failed to boot, displaying a BSOD with `CRITICAL_PROCESS_DIED` bug check code instead. With no recent restore points the task of getting my system back became rather complicated; further complexity arose from the fact that I did not have another computer at my disposal to use as a host for kernel-mode debugging. Software-wise my meager setup included a copy of Ubuntu and WinRE (Windows Recovery Environment), that is, most of Windows applications were out of reach. Luckily, the crash dump driver stack remained intact, hence there was a dump file, ready for analysis, on the system hard drive. 

Let us see how far one can get given the lack of proper environment for debugging. 

This write-up will be detailed enough for a person without prior reversing experience (apart from that in basic assembler) to follow without any difficulty. 

## Getting Started

From the very beginning, we are faced with the problem of parsing the dump file. On Linux, two tools are available for that purpose: [volatility](https://www.volatilityfoundation.org/) and [rekall](http://www.rekall-forensic.com/), powerful open source memory forensic frameworks implemented in python. However, at the time of writing, both were limited in the type of dump files they could handle. [Microsoft's documentation](https://docs.microsoft.com/en-us/windows-hardware/drivers/debugger/varieties-of-kernel-mode-dump-files) names four types of dump files based on what is included in them (in order of decreasing size): complete, active, kernel, small, but not mentioned there is another classification criterion – how physical pages are stored, i.e. differences in the file format. The structure `_DMP_HEADER64` ([a dump header](https://computer.forensikblog.de/en/2008/02/64bit-crash-dumps.html)), contains `_PHYSICAL_MEMORY_DESCRIPTOR` as its substructure that, in turn, represents physical memory in a form of runs list, each run being a sequence of pages in a continuous region of physical address space. Attempting to parse a dump file created by Windows 10, one is likely to find the contents of `_PHYSICAL_MEMORY_DESCRIPTOR` initialized with invalid values: the space occupied by the structure is filled with an ASCII string “PAGE”, while the presence/absence of a physical memory page in the dump is indicated by a bit in a bitmap (stored in the SDMP/FDMP subheader). 

{% include code-block-header.html title="Invalid Physical Memory Descriptor (offset 0x88)" %}
{% highlight none linenos %}
hexdump -C -n 1000 MEMORY.dmp
00000000  50 41 47 45 44 55 36 34  0f 00 00 00 ee 42 00 00  |PAGEDU64.....B..|
00000010  00 00 f0 55 01 00 00 00  00 00 00 00 80 80 ff ff  |...U............|
00000020  90 b2 03 2f 02 f8 ff ff  10 44 03 2f 02 f8 ff ff  |.../.....D./....|
00000030  64 86 00 00 04 00 00 00  ef 00 00 00 50 41 47 45  |d...........PAGE|
00000040  80 a5 8b 61 08 b9 ff ff  00 00 00 00 00 00 00 00  |...a............|
00000050  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
00000080  20 45 02 2f 02 f8 ff ff  ·50 41 47 45 50 41 47 45·  | E./....·PAGEPAGE·| ¡<--¡
00000090  ·50 41 47 45 50 41 47 45  50 41 47 45 50 41 47 45·  |·PAGEPAGEPAGEPAGE·| ¡<--¡
*
00000340  ·50 41 47 45 50 41 47 45·  00 00 00 00 00 00 00 00  |·PAGEPAGE·........|
00000350  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
00000370  00 00 00 00 00 00 00 00  0f 00 10 00 80 1f 00 00  |................|
00000380  10 00 2b 00 2b 00 53 00  2b 00 18 00 46 02 00 00  |..+.+.S.+...F...|
00000390  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
000003c0  00 27 e5 5d 08 b9 ff ff  ef 00 00 00 00 00 00 00  |.'.]............|
000003d0  80 a5 8b 61 08 b9 ff ff  03 a5 8b 61 08 b9 ff ff  |...a.......a....|
000003e0  38 89 0d e0 0d fe ff ff                           |8.......|
{% endhighlight %}


Two values for the `DumpType` field were introduced to represent files of this new format – 5 (full dump) and 6 (kernel dump). As of today, anyone faced with the same problem would be out of luck since the new file format is not fully supported in the aforementioned forensic software. 

{% capture alert-text %}
On a side note, a little [tweaking to the registry](https://support.microsoft.com/en-us/help/254649/overview-of-memory-dump-file-options-for-windows) will produce a so-called “full bitmap dump” (DumpType = 5) rekall recognizes. All it takes is setting the value of `CrashDumpEnabled` to 1 in `HKEY_LOCAL_MACHINE\System\CurrentControlSet\Control\CrashControl` and rebooting the system twice. During the first boot relevant (or all, in the case of a full dump) memory pages are written to the Windows pagefile in response to the critical error; it is the second boot that will create the crash dump file itself. Recall (and volatility) is rather a versatile framework, thus significant insights into the core of many issues can be gained by employing it and the reader is encouraged to do the experiment in his/hers spare time. However, in this case I will be using another tool, WinDbg, chosen for the added convenience of a disassembler. 
{% endcapture %}
{% include info-box.html text=alert-text %}

This is when _WinDbg_ came to the rescue! Part of the Debugging Tool for Windows suit, is **cdb**, a stand-alone command line debugger that runs perfectly well under WinRE.  I happened to have WDK installed on my computer, so procuring a copy of _cdb.exe_ was not a problem. Now to the debugging symbols. Having run into technical issues trying to set up an internet connection under WinRE, I opted out to use yet another utility written in python – **pdbparse**. _Pdbparse_ installs _symchk.py_ script which could be used for the purpose. 

{% capture alert-text %}
**_pdbparse_** relies on another library called **_construct_**, but not the newest version of it: **_construct_** has undergone major modifications interface-wise thus rendering itself incompatible with some of the software that was using it. There is a corresponding restriction specified in the **_pdbparse's_** setup script, given that the latest version is pulled from the repository. If not, just preinstall **_construct_** manually by typing `sudo pip install 'construct<2.7.0'`
{% endcapture %}
{% include info-box.html text=alert-text %}

## Analysis

### At a Glance

Unless you are able to set up a connection to Microsofts' symbol, a good idea is to download symbols for the essential Windows modules: _ntoskrnl.exe_, _ntdll.dll_, _hal.dll_ and then add the rest upon call stack inspection. For example, having noticed calls to _csrsrv.dll_, I used _symchk.py_ script to retrieve a matching .pdb file. Let us begin by telling  **cdb** where the debugging symbol files are located.

{% include code-block-header.html title="cdb: Configuring Debug Symbols" %}
{% highlight none linenos %}
0: kd> .sympath d:\WinRestore\Symbols\
Symbol search path is: d:\WinRestore\Symbols\
Expanded Symbol search path is: d:\winRestore\symbols\

************* Symbol Path validation summary **************
Response                         Time (ms)     Location
OK                                             d:\WinRestore\Symbols\

0: kd> .reload
Loading Kernel Symbols
.....................................Page 20015b4f4 too large to be in the dump file.
..........................
................................................................
..........................
Loading User Symbols
...
Loading unloaded module list
.......…
{% endhighlight %}

Every crash dump analysis I have encountered so far started with `!analyze -v`. Here we go...


{% include code-block-header.html title="cdb: Bugcheck Analysis" %}
{% highlight none linenos %}
0: kd> !analyze -v
*******************************************************************************
*                                                                             *
*                        Bugcheck Analysis                                    *
*                                                                             *
*******************************************************************************

·CRITICAL_PROCESS_DIED· (ef)
        A critical system process died
Arguments:
Arg1: ffffd18c66891580, Process object or thread object
Arg2: 0000000000000000, If this is 0, a process died. If this is 1, a thread died.
Arg3: 0000000000000000
Arg4: 0000000000000000

Debugging Details:
------------------


DUMP_CLASS: 1

DUMP_QUALIFIER: 401

BUILD_VERSION_STRING:  17134.1.amd64fre.rs4_release.180410-1804

[...]

DUMP_TYPE:  1

BUGCHECK_P1: ffffd18c66891580

BUGCHECK_P2: 0

BUGCHECK_P3: 0

BUGCHECK_P4: 0

PROCESS_NAME:  ·csrss.exe·

CRITICAL_PROCESS:  ·csrss.exe·

EXCEPTION_CODE: (Win32) 0x66897700 (1720284928) - <Unable to get error code text>

ERROR_CODE: (NTSTATUS) 0x66897700 - <Unable to get error code text>

[...]

DEFAULT_BUCKET_ID:  WIN8_DRIVER_FAULT

BUGCHECK_STR:  0xEF

CURRENT_IRQL:  0

ANALYSIS_SESSION_HOST:  MININT-T54U0TR

ANALYSIS_SESSION_TIME:  01-11-2019 06:57:52.0917

ANALYSIS_VERSION: 10.0.14321.1024 amd64fre

LAST_CONTROL_TRANSFER:  from fffff800a7187101 to fffff800a6bb2490

STACK_TEXT:
ffffbc88`eeb10938 fffff800`a7187101 : 00000000`000000ef ffffd18c`66891580 00000000`00000000 00000000`00000000 : nt!KeBugCheckEx
ffffbc88`eeb10940 fffff800`a70c818d : 00000000`00000000 fffff800`a6a13ae5 ffffd18c`66891580 00000000`c0000034 : nt!PspCatchCriticalBreak+0xfd
ffffbc88`eeb109e0 fffff800`a6fb6488 : ffffd18c`00000000 00000000`00000000 ffffd18c`66891580 ffffd18c`66891858 : nt!PspTerminateAllThreads+0x112471
ffffbc88`eeb10a50 fffff800`a6fb7fd1 : ffffffff`ffffffff ffffbc88`eeb10b80 ffffd18c`66891580 ffffbc88`eeb10a01 : nt!PspTerminateProcess+0xe0
ffffbc88`eeb10a90 fffff800`a6bc2b43 : ffffd18c`00000248 ffffd18c`66897700 ffffd18c`66891580 0000014e`4a4055f5 : nt!NtTerminateProcess+0xa9
ffffbc88`eeb10b00 00007ff9`cbf2a474 : 00007ff6`eb571704 0000014e`4a4053f0 0000014e`4a4055f5 00000000`00000078 : nt!KiSystemServiceCopyEnd+0x13
00000023`5136f6c8 00007ff6`eb571704 : 0000014e`4a4053f0 0000014e`4a4055f5 00000000`00000078 00000000`00000205 : ntdll!NtTerminateProcess+0x14
00000023`5136f6d0 00007ff6`eb571301 : 0000014e`4a4055f5 00000000`0000000b 00000000`00000001 00000000`0000000d : ·csrss!main+0x3d4·
00000023`5136f710 00007ff6`eb571016 : 00000000`00000000 00000000`0000000a 00000000`00000000 00000000`00000000 : csrss!NtProcessStartup_AfterSecurityCookieInitialized+0x2e1
00000023`5136f7a0 00007ff9`cbf0146f : 00000000`00000000 00000000`00000000 00000000`00000000 00000000`00000000 : csrss!NtProcessStartup+0x16
00000023`5136f7d0 00000000`00000000 : 00000000`00000000 00000000`00000000 00000000`00000000 00000000`00000000 : ntdll!RtlUserThreadStart+0x2f


STACK_COMMAND:  kb

THREAD_SHA1_HASH_MOD_FUNC:  8db425cf0a36127b5bcc0773f2d7250976d41454

THREAD_SHA1_HASH_MOD_FUNC_OFFSET:  b7d9f40c1fcd90279ce7c2bf08d60986a2851e14

THREAD_SHA1_HASH_MOD:  b23b58f331f7d856e76ca5bf03ff9d670600d544

FOLLOWUP_IP:
ntdll!NtTerminateProcess+14
00007ff9`cbf2a474 c3              ret

FAULT_INSTR_CODE:  c32ecdc3

SYMBOL_STACK_INDEX:  6

SYMBOL_NAME:  ntdll!NtTerminateProcess+14

FOLLOWUP_NAME:  MachineOwner

MODULE_NAME: ntdll

IMAGE_NAME:  ntdll.dll

DEBUG_FLR_IMAGE_TIMESTAMP:  0

BUCKET_ID_FUNC_OFFSET:  14

FAILURE_BUCKET_ID:  0xEF_csrss.exe_BUGCHECK_CRITICAL_PROCESS_66897700_ntdll!NtTerminateProcess

BUCKET_ID:  0xEF_csrss.exe_BUGCHECK_CRITICAL_PROCESS_66897700_ntdll!NtTerminateProcess

PRIMARY_PROBLEM_CLASS:  0xEF_csrss.exe_BUGCHECK_CRITICAL_PROCESS_66897700_ntdll!NtTerminateProcess

TARGET_TIME:  2019-01-10T15:55:49.000Z

OSBUILD:  17134

OSSERVICEPACK:  0

SERVICEPACK_NUMBER: 0

OS_REVISION: 0

SUITE_MASK:  784

PRODUCT_TYPE:  1

OSPLATFORM_TYPE:  x64

OSNAME:  Windows 10

OSEDITION:  Windows 10 WinNt TerminalServer SingleUserTS Personal

OS_LOCALE:

USER_LCID:  0

OSBUILD_TIMESTAMP:  2018-09-19 19:40:30

BUILDDATESTAMP_STR:  180410-1804

BUILDLAB_STR:  rs4_release

BUILDOSVER_STR:  10.0.17134.1.amd64fre.rs4_release.180410-1804

ANALYSIS_SESSION_ELAPSED_TIME: 905

ANALYSIS_SOURCE:  KM

FAILURE_ID_HASH_STRING:  km:0xef_csrss.exe_bugcheck_critical_process_66897700_ntdll!ntterminateprocess

FAILURE_ID_HASH:  {1c1f0cbd-836a-f251-4b76-76293e344c02}

Followup:     MachineOwner
---------
{% endhighlight %}

A cursory glance reveals the following points of interest:
- Line **8** confirms that the bugcheck code matches the one seen on the BSOD.
- Lines **24** and **128** give us the exact Windows edition and build.
- Lines **38** and **40** identify **_csrss_** as the culprit. **_Csrss_** is a so-called [Client/Server Runtime Subsystem](https://docs.microsoft.com/en-us/sysinternals/learn/windows-internals) whose task is to provide the Windows subsystem functionality (I/O, windowing, process creation, etc) to applications and other subsystems. It is an essential OS component other subsystems rely on and, therefore, csrss is marked as a critical process meaning that its termination will lead to a system crash. It explains the bug check code perfectly well. Despite being "critical", csrss still runs in user mode; we should keep it in mind. 

Of course, the most significant finding at this stage is an offset of instruction calling _NtTerminateProcess_ -- it is located in the function **_csrss!main_** at offset `0x3d4 - <length of call instruction>` (see line **70**). The next logical step would be an analysis of _csrss!main_ disassembly in the hope of tracing back the error origin.

### Identifying the Faulty Function and Retrieving its Error Code


{% include code-block-header.html title="cdb: csrss!main Disassembly" %}
{% highlight none linenos %}

0: kd> uf csrss!main
csrss!main:
00007ff6`eb571330 48895c2408      mov     qword ptr [rsp+8],rbx
00007ff6`eb571335 57              push    rdi
00007ff6`eb571336 4883ec30        sub     rsp,30h
00007ff6`eb57133a 41b904000000    mov     r9d,4
00007ff6`eb571340 c744245001000000 mov     dword ptr [rsp+50h],1
00007ff6`eb571348 488bda          mov     rbx,rdx
00007ff6`eb57134b 4c8d442450      lea     r8,[rsp+50h]
00007ff6`eb571350 8bf9            mov     edi,ecx
00007ff6`eb571352 4883c9ff        or      rcx,0FFFFFFFFFFFFFFFFh
00007ff6`eb571356 418d5132        lea     edx,[r9+32h]
00007ff6`eb57135a ff15c80d0000    call    qword ptr [csrss!_imp_NtSetInformationProcess (00007ff6`eb572128)]
00007ff6`eb571360 488b0da90d0000  mov     rcx,qword ptr [csrss!_imp_CsrUnhandledExceptionFilter (00007ff6`eb572110)]
00007ff6`eb571367 ff15d30d0000    call    qword ptr [csrss!_imp_RtlSetUnhandledExceptionFilter (00007ff6`eb572140)]
00007ff6`eb57136d 41b904000000    mov     r9d,4
00007ff6`eb571373 c74424580d000000 mov     dword ptr [rsp+58h],0Dh
00007ff6`eb57137b 4c8d442458      lea     r8,[rsp+58h]
00007ff6`eb571380 4883c9ff        or      rcx,0FFFFFFFFFFFFFFFFh
00007ff6`eb571384 418d5101        lea     edx,[r9+1]
00007ff6`eb571388 ff159a0d0000    call    qword ptr [csrss!_imp_NtSetInformationProcess (00007ff6`eb572128)]
00007ff6`eb57138e 4533c9          xor     r9d,r9d
00007ff6`eb571391 4533c0          xor     r8d,r8d
00007ff6`eb571394 33c9            xor     ecx,ecx
00007ff6`eb571396 418d5101        lea     edx,[r9+1]
00007ff6`eb57139a ff15900d0000    call    qword ptr [csrss!_imp_RtlSetHeapInformation (00007ff6`eb572130)]
00007ff6`eb5713a0 41b908000000    mov     r9d,8
00007ff6`eb5713a6 c744242802000000 mov     dword ptr [rsp+28h],2
00007ff6`eb5713ae 4c8d442428      lea     r8,[rsp+28h]
00007ff6`eb5713b3 c744242c01000000 mov     dword ptr [rsp+2Ch],1
00007ff6`eb5713bb 4883c9ff        or      rcx,0FFFFFFFFFFFFFFFFh
00007ff6`eb5713bf 418d512c        lea     edx,[r9+2Ch]
00007ff6`eb5713c3 ff155f0d0000    call    qword ptr [csrss!_imp_NtSetInformationProcess (00007ff6`eb572128)]
00007ff6`eb5713c9 488bd3          mov     rdx,rbx
00007ff6`eb5713cc 8bcf            mov     ecx,edi
00007ff6`eb5713ce ff15440d0000    call    qword ptr [csrss!_imp_CsrServerInitialization (00007ff6`eb572118)]  ¡; <-- This func returned an error in eax¡
00007ff6`eb5713d4 8bd8            mov     ebx,eax
00007ff6`eb5713d6 85c0            test    eax,eax
00007ff6`eb5713d8 0f881a030000    js      ·csrss!main+0x3c8· (00007ff6`eb5716f8)

csrss!main+0xae:
00007ff6`eb5713de 41b904000000    mov     r9d,4
00007ff6`eb5713e4 c744242000000000 mov     dword ptr [rsp+20h],0
00007ff6`eb5713ec 4c8d442420      lea     r8,[rsp+20h]
00007ff6`eb5713f1 4883c9ff        or      rcx,0FFFFFFFFFFFFFFFFh
00007ff6`eb5713f5 418d5108        lea     edx,[r9+8]
00007ff6`eb5713f9 ff15290d0000    call    qword ptr [csrss!_imp_NtSetInformationProcess (00007ff6`eb572128)]
00007ff6`eb5713ff 8bd3            mov     edx,ebx
00007ff6`eb571401 48c7c1feffffff  mov     rcx,0FFFFFFFFFFFFFFFEh
00007ff6`eb571408 ff155a0d0000    call    qword ptr [csrss!_imp_NtTerminateThread (00007ff6`eb572168)]
00007ff6`eb57140e 488b5c2440      mov     rbx,qword ptr [rsp+40h]
00007ff6`eb571413 33c0            xor     eax,eax
00007ff6`eb571415 4883c430        add     rsp,30h
00007ff6`eb571419 5f              pop     rdi
00007ff6`eb57141a c3              ret

·csrss!main+0x3c8:·
00007ff6`eb5716f8 8bd3            mov     edx,ebx
00007ff6`eb5716fa 4883c9ff        or      rcx,0FFFFFFFFFFFFFFFFh
00007ff6`eb5716fe ff15340a0000    call    qword ptr [csrss!_imp_NtTerminateProcess (00007ff6`eb572138)]   ¡; <-- So we ended up here¡
·00007ff6`eb571704· 90              nop
00007ff6`eb571705 e9d4fcffff      jmp     csrss!main+0xae (00007ff6`eb5713de)

{% endhighlight %}

_Csrss!main_'s entry point is at `0x00007ff6eb571330`. A simple offset calculation `0x00007ff6eb571330 + 0x3d4 = 0x7ff6eb571704` leads us to an address of the instruction following the call to _NtTerminateProcess_ in line **60**. How did we get here? Obviuosly, by executing a statement like this one: `if (error_occured) TeminateProcess(...)`  _Cbd_ disassember automatically creates labels for targets of jump instructions, so all that needs to be done is to go up until such a label is encountered (_csrss!main+0x3c8_ in line **57**) and find all the jump instructions referencing it. In this case, there is only one -- in line **39**. Quick examination of the the nearby code allows us to determine the only possible scenario: _CsrServerInitialization_ returns with an error code and causes _csrss_ to terminate itself.  Voilà! Easy!

{% capture alert-text %}
A little side note on Windows call convention is called for here. On x64 platform the first four parameters are passed in _rcx_, _rdx_, _r8_ and _r9_ respectively (the rest are pushed onto stack), and return value - in _rax_. 
{% endcapture %}
{% include note-box.html text=alert-text %}

Where should we move from here? Evidently, _CsrServerInitialization_ returned a non-zero error code that was later passed to _NtTerminateProcess_ as a parameter via the chain of registers: eax&#8594;ebx&#8594;edx. Let us see what _NtTerminateProcess_ does with it. 

{% include code-block-header.html title="cdb: nt!TerminateProcess Disassembly" %}
{% highlight none linenos %}
0: kd> dq csrss!_imp_NtTerminateProcess
00007ff6`eb572138  ·00007ff9`cbf2a460· 00007ff9`cbeff020  ¡<-- reading import table to get to nt!TerminateProcess¡
00007ff6`eb572148  00007ff9`cbe97fd0 00007ff9`cbe94770
00007ff6`eb572158  00007ff9`cbf863e0 00007ff9`cbec17f0
00007ff6`eb572168  00007ff9`cbf2a940 00007ff9`cbf2ded0
00007ff6`eb572178  00007ff9`cbe9a960 00007ff9`cbea24f0
00007ff6`eb572188  00007ff9`cbf167a0 00007ff9`cbf1aeb0
00007ff6`eb572198  00000000`00000000 00007ff9`cbf1a950
00007ff6`eb5721a8  00007ff9`cbf1a9f0 00001450`00001000

0: kd> uf ·0x00007ff9cbf2a460·
ntdll!NtTerminateProcess:
00007ff9`cbf2a460 4c8bd1          mov     r10,rcx
00007ff9`cbf2a463 b82c000000      mov     eax,2Ch
00007ff9`cbf2a468 f604250803fe7f01 test    byte ptr [SharedUserData+0x308 (00000000`7ffe0308)],1
00007ff9`cbf2a470 7503            jne     ntdll!NtTerminateProcess+0x15 (00007ff9`cbf2a475)

ntdll!NtTerminateProcess+0x12:
00007ff9`cbf2a472 0f05            syscall ¡;it does not save any params performing a syscall straight away¡
00007ff9`cbf2a474 c3              ret

ntdll!NtTerminateProcess+0x15:
00007ff9`cbf2a475 cd2e            int     2Eh
00007ff9`cbf2a477 c3              ret

{% endhighlight %}

It turns out, _NtTerminateProcess_ does not save parameters (performing a syscall straight away) so off into the ring0 we go. 

{% include code-block-header.html title="cdb: Disassembly of nt!KiSystemCall64 Prologue" %}
{% highlight none linenos %}

nt!KiSystemCall64:
fffff800`a6bc26c0 0f01f8          swapgs
fffff800`a6bc26c3 654889242510000000 mov   qword ptr gs:[10h],rsp   ¡; saving user stack rsp¡
fffff800`a6bc26cc 65488b2425a8010000 mov   rsp,qword ptr gs:[1A8h]  ¡; loading kernel stack rsp¡
fffff800`a6bc26d5 6a2b            push    2Bh                       ¡; rsp -= 8, 0x2B can be used as a marker¡
fffff800`a6bc26d7 65ff342510000000 push    qword ptr gs:[10h]       ¡; push user stack rsp, rsp -= 8¡
fffff800`a6bc26df 4153            push    r11                       ¡; rsp -= 8¡
fffff800`a6bc26e1 6a33            push    33h                       ¡; rsp -= 8¡
fffff800`a6bc26e3 51              push    rcx                       ¡; rsp -= 8¡
fffff800`a6bc26e4 498bca          mov     rcx,r10
fffff800`a6bc26e7 4883ec08        sub     rsp,8                     ¡; rsp -= 8¡
fffff800`a6bc26eb 55              push    rbp                       ¡; rsp -= 8¡
fffff800`a6bc26ec 4881ec58010000  sub     rsp,158h                  ¡; allocating 0x158 bytes for lacal data, rsp -= 0x158¡
fffff800`a6bc26f3 488dac2480000000 lea     rbp,[rsp+80h]
fffff800`a6bc26fb 48899dc0000000  mov     qword ptr [rbp+0C0h],rbx  ¡; rbx is recorded¡ 
fffff800`a6bc2702 4889bdc8000000  mov     qword ptr [rbp+0C8h],rdi
fffff800`a6bc2709 4889b5d0000000  mov     qword ptr [rbp+0D0h],rsi
fffff800`a6bc2710 488945b0        mov     qword ptr [rbp-50h],rax   ¡; rax will contain 0x2C and can be used as a marker¡
fffff800`a6bc2714 48894db8        mov     qword ptr [rbp-48h],rcx
fffff800`a6bc2718 488955c0        mov     qword ptr [rbp-40h],rdx   ¡;<-- here rdx is pushed onto stack¡
fffff800`a6bc271c 65488b0c2588010000 mov   rcx,qword ptr gs:[188h]
fffff800`a6bc2725 488b8920020000  mov     rcx,qword ptr [rcx+220h]
fffff800`a6bc272c 488b8938080000  mov     rcx,qword ptr [rcx+838h]
fffff800`a6bc2733 6548890c2570020000 mov   qword ptr gs:[270h],rcx
fffff800`a6bc273c 650fb604257b020000 movzx eax,byte ptr gs:[27Bh]
fffff800`a6bc2745 653804257a020000 cmp     byte ptr gs:[27Ah],al
fffff800`a6bc274d 7411            je      nt!KiSystemCall64+0xa0 (fffff800`a6bc2760)
[...]

{% endhighlight %}

The disassember listing looks promising: line **20** clearly indicates that the value of **_edx_** was saved on kernel stack. So was the value of **_eax_**, that could be used as a marker to make sure our stack offset calculations are correct. Windows keeps two separate stacks for user- and kermel-mode code to use, with switch between the two observable in the form of address change (see lines **68**-**69** of the Bugcheck Analysis listing) during a syscall, as the transitions into kernel mode takes place. In line **4** rsp is initialized with the top of kernel-mode stack and this is where we start.

{% include code-block-header.html title="cdb: Top of Kernel-mode Stack Before the Call to TerminateProcess" %}
{% highlight none linenos %}
0: kd> dq gs:[1A8h]	

002b:00000000`000001a8  ·ffffbc88`eeb10c90· 00000000`00000000
002b:00000000`000001b8  fffff800`a590b910 00000893`3d040106
002b:00000000`000001c8  00000000`00000000 00000000`00000000
002b:00000000`000001d8  00000000`00000000 00000000`00000000
002b:00000000`000001e8  00000000`00000000 00000000`00000000
002b:00000000`000001f8  00000000`00000000 ffffd18c`5e557231
002b:00000000`00000208  02080200`00010001 00000000`00000000
002b:00000000`00000218  00000000`00000000 00000000`00000000

{% endhighlight %} 

The unused portion of stack begins at `0xffffbc88eeb10c90` and on x64 architecture "grows" downwards, towards smaller addresses. It is typically a good idea to examine the stack in order to make sure its content matches the instructions that presumably "filled it in" with data. 

{% include code-block-header.html title="cdb: Stack Dump" %}
{% highlight none linenos %}

0: kd> dq ffffbc88eeb10c20
ffffbc88`eeb10c20  00000000`00000000 00000000`00000000
ffffbc88`eeb10c30  00000000`00000000 00000000`00000000
ffffbc88`eeb10c40  00000000`c0000034 00000000`0000000a 
ffffbc88`eeb10c50  0000014e`4a4055f5 00000000`00000000 ¡; rbp = 0¡ 
ffffbc88`eeb10c60  00000000`00000000 00007ff9`cbf2a474 ¡; supposedly, rcx and reserved space¡
ffffbc88`eeb10c70  00000000`00000033 00000000`00000246 ¡; r11 and 33h¡
ffffbc88`eeb10c80  00000023`5136f6c8 00000000`0000002b ¡; here are the 2Bh marker and user stack rsp, exactly in the order they were pushed¡ 
·ffffbc88`eeb10c90·  ffffbc88`eeb11000                   ¡; free stack space begins at 0xffffbc88eeb10c90 and "grows" towards smaller addresses¡
                   ¡------top--------¡ 
{% endhighlight %}

Paradoxically, the results are as promising as they are inconclusive: on the one hand, we found the "2Bh" marker and user stack rsp, on other hand, the value of rcx did not match the one recorded on stack, and, to top it all off, rbp == 0 seems to be suspicious. Let us not get discouraged. The latter might have been overwritten somewhere down the road and we are, probably, still on the right track. The last instruction traceable in this stack dump is `push rbp` (in line **12**). Then, as a result of memory allocation for local variables, rsp is offset by 0x158: `rsp = 0xffffbc88eeb10c58 - 0x158 = 0xffffbc88eeb10b00` and rbp, ostensibly, is reassigned to point to the new stack frame: `rbp = rsp + 0x80 = ffffbc88eeb10b80`. The further computations are relative to **rbp**.

{% include code-block-header.html title="cdb: Stack Dump #2" %}
{% highlight none linenos %}

0: kd> dq ffffbc88`eeb10b30
ffffbc88`eeb10b30  00000000`0000002c ffffffff`ffffffff
ffffbc88`eeb10b40  00000000`c0000034 00000023`5136f218
ffffbc88`eeb10b50  00007ff9`cbfff4d0 00000000`00000000
ffffbc88`eeb10b60  00000000`00000246 00000023`514dc000
ffffbc88`eeb10b70  00000000`00000000 00000000`00000000
·ffffbc88`eeb10b80·  00000000`00000000 00000000`00000000
		   ¡------rbp--------¡ 
{% endhighlight %}

Recovered from the stack dump are: rax == 0x2c (at 0xffffbc88eeb10b30), rcx == 0xffffffffffffffff (at 0xffffbc88eeb10b38), rdx == 0xc0000034 (at ffffbc88eeb10b40), and rbx == 0xc0000034 (at 0xffffbc88eeb10c40, see dump #1). Below is the relevant portion of _nt!KiSystemCall64_.

{% include code-block-header.html title="cdb: a Fragment of nt!KiSystemCall64" %}
{% highlight nasm linenos %}

0xfffff800a6bc26ec  sub     rsp,158h                  ; allocating 0x158 bytes for lacal data, rsp -= 0x158
0xfffff800a6bc26f3  lea     rbp,[rsp+80h]             ; rbp = ffffbc88`eeb10b80
0xfffff800a6bc26fb  mov     qword ptr [rbp+0C0h],rbx  ; rbp + 0xC0 = ffffbc88`eeb10c40, holds 0x00000000c0000034
0xfffff800a6bc2702  mov     qword ptr [rbp+0C8h],rdi
0xfffff800a6bc2709  mov     qword ptr [rbp+0D0h],rsi
0xfffff800a6bc2710  mov     qword ptr [rbp-50h],rax   ; rbp - 0x50 = ffffbc88`eeb10b30, holds 0x000000000000002c
0xfffff800a6bc2714  mov     qword ptr [rbp-48h],rcx   ; rbp - 0x48 = ffffbc88`eeb10b38, holds ffffffffffffffff == INVALID_HANDLE 
0xfffff800a6bc2718  mov     qword ptr [rbp-40h],rdx   ; rbp - 0x40 = ffffbc88`eeb10b40, holds 0x00000000c0000034 (NTSATUS passed down to us)

{% endhighlight %}

It looks like we are golden. 0x2c is the index of _TerminateProcess_ in Microsoft's system calls table as indicated by the `mov eax,2Ch` instruction in line **14** of _NtTerminateProcess_ disassembly. **_rcx_** holds the value of the ProcessHandle argument passed to _NtTerminateProcess_. [Take a look at](https://undocumented.ntinternals.net/index.html?page=UserMode%2FUndocumented%20Functions%2FNT%20Objects%2FProcess%2FNtTerminateProcess.html) the function prototype: `NTSYSAPI NTSTATUS NTAPI NtTerminateProcess(IN HANDLE ProcessHandle, IN NTSTATUS ExitStatus);` The first argument is a handle of the process being terminated, which can be set to `INVALID_HANDLE` (0xffffffffffffffff) if the calling process intends to terminate itself, and it is exactly what has been done in this case. Finally, exist status is supplied in _rdx_ (recall Windows calling convention). Going back to csrss!main, we notice that the value _CsrServerInitialization_ returns (in _eax_) is copied to _ebx_ (line **37**) and not overwritten throughout the remainder of the function body, hence both, _edx_ and _ebx_, should contrain the same value, ExitStatus. And they, indeed, do.

### The Culprit Under a Microscope 

So far we figured out that _CsrServerInitialization()_ terminates with the `STATUS_OBJECT_NAME_NOT_FOUND` (0xc0000034) error. According to the [documentation](https://msdn.microsoft.com/en-us/library/cc704588.aspx) it, as you might have guessed, means "The object name is not found". Let us dig deeper. 


{% include code-block-header.html title="cdb: CSRSRV!CsrServerInitialization Disassembly Listing" %}
{% highlight none linenos %}

0: kd> uf CSRSRV!CsrServerInitialization
CSRSRV!CsrServerInitialization:
00007ff9`c81834b0 48895c2408      mov     qword ptr [rsp+8],rbx
00007ff9`c81834b5 4889742410      mov     qword ptr [rsp+10h],rsi
00007ff9`c81834ba 57              push    rdi
00007ff9`c81834bb 4883ec40        sub     rsp,40h
00007ff9`c81834bf 488bfa          mov     rdi,rdx
00007ff9`c81834c2 8bf1            mov     esi,ecx
00007ff9`c81834c4 ff15be5c0000    call    qword ptr [CSRSRV!_imp_RtlGetCurrentServiceSessionId (00007ff9`c8189188)]
00007ff9`c81834ca 890514e30000    mov     dword ptr [CSRSRV!ServiceSessionId (00007ff9`c81917e4)],eax
00007ff9`c81834d0 33db            xor     ebx,ebx
00007ff9`c81834d2 48891d9fe10000  mov     qword ptr [CSRSRV!CsrApiPort (00007ff9`c8191678)],rbx
00007ff9`c81834d9 4c8d0da0e10000  lea     r9,[CSRSRV!CsrTraceHandle (00007ff9`c8191680)]
00007ff9`c81834e0 4533c0          xor     r8d,r8d
00007ff9`c81834e3 33d2            xor     edx,edx
00007ff9`c81834e5 488d0d94610000  lea     rcx,[CSRSRV!CsrEventProvider (00007ff9`c8189680)]
00007ff9`c81834ec ff15865d0000    call    qword ptr [CSRSRV!_imp_EtwEventRegister (00007ff9`c8189278)]
00007ff9`c81834f2 85c0            test    eax,eax
00007ff9`c81834f4 0f85e8390000    jne     CSRSRV!guard_dispatch_icall_nop+0x252 (00007ff9`c8186ee2)

CSRSRV!CsrServerInitialization+0x4a:
00007ff9`c81834fa e8b1fdffff      call    CSRSRV!CsrRemoveUnneededPrivileges (00007ff9`c81832b0)
00007ff9`c81834ff 85c0            test    eax,eax
00007ff9`c8183501 0f88e7390000    js      CSRSRV!guard_dispatch_icall_nop+0x25e (00007ff9`c8186eee)

CSRSRV!CsrServerInitialization+0x57:
00007ff9`c8183507 4533c9          xor     r9d,r9d
00007ff9`c818350a 458d4140        lea     r8d,[r9+40h]
00007ff9`c818350e 488d152be20000  lea     rdx,[CSRSRV!CsrNtSysInfo (00007ff9`c8191740)]
00007ff9`c8183515 33c9            xor     ecx,ecx
00007ff9`c8183517 ff158b5c0000    call    qword ptr [CSRSRV!_imp_NtQuerySystemInformation (00007ff9`c81891a8)]
00007ff9`c818351d 85c0            test    eax,eax
00007ff9`c818351f 0f88d8390000    js      CSRSRV!guard_dispatch_icall_nop+0x26d (00007ff9`c8186efd)

CSRSRV!CsrServerInitialization+0x75:
00007ff9`c8183525 65488b042560000000 mov   rax,qword ptr gs:[60h]
00007ff9`c818352e 488b4830        mov     rcx,qword ptr [rax+30h]
00007ff9`c8183532 48890d97e20000  mov     qword ptr [CSRSRV!CsrHeap (00007ff9`c81917d0)],rcx
00007ff9`c8183539 4c8d0dd0600000  lea     r9,[CSRSRV!`string' (00007ff9`c8189610)]
00007ff9`c8183540 4c8d05b9600000  lea     r8,[CSRSRV!`string' (00007ff9`c8189600)]
00007ff9`c8183547 33d2            xor     edx,edx
00007ff9`c8183549 ff15215d0000    call    qword ptr [CSRSRV!_imp_RtlCreateTagHeap (00007ff9`c8189270)]
00007ff9`c818354f 890583e20000    mov     dword ptr [CSRSRV!CsrBaseTag (00007ff9`c81917d8)],eax
00007ff9`c8183555 e8e6fdffff      call    CSRSRV!CsrSetProcessSecurity (00007ff9`c8183340)
00007ff9`c818355a 85c0            test    eax,eax
00007ff9`c818355c 0f88aa390000    js      CSRSRV!guard_dispatch_icall_nop+0x27c (00007ff9`c8186f0c)

CSRSRV!CsrServerInitialization+0xb2:
00007ff9`c8183562 488d0587e00000  lea     rax,[CSRSRV!CsrNtSessionList (00007ff9`c81915f0)]
00007ff9`c8183569 48890588e00000  mov     qword ptr [CSRSRV!CsrNtSessionList+0x8 (00007ff9`c81915f8)],rax
00007ff9`c8183570 48890579e00000  mov     qword ptr [CSRSRV!CsrNtSessionList (00007ff9`c81915f0)],rax
00007ff9`c8183577 488d0d22e20000  lea     rcx,[CSRSRV!CsrNtSessionLock (00007ff9`c81917a0)]
00007ff9`c818357e ff15845e0000    call    qword ptr [CSRSRV!_imp_RtlInitializeCriticalSection (00007ff9`c8189408)]
00007ff9`c8183584 85c0            test    eax,eax
00007ff9`c8183586 0f888f390000    js      CSRSRV!guard_dispatch_icall_nop+0x28b (00007ff9`c8186f1b)

CSRSRV!CsrServerInitialization+0xdc:
00007ff9`c818358c e87f1a0000      call    CSRSRV!CsrInitializeProcessStructure (00007ff9`c8185010)
00007ff9`c8183591 85c0            test    eax,eax
00007ff9`c8183593 0f8891390000    js      CSRSRV!guard_dispatch_icall_nop+0x29a (00007ff9`c8186f2a)

CSRSRV!CsrServerInitialization+0xe9:
00007ff9`c8183599 4c8d4c2460      lea     r9,[rsp+60h]
00007ff9`c818359e 4c8d442428      lea     r8,[rsp+28h]
00007ff9`c81835a3 488bd7          mov     rdx,rdi
00007ff9`c81835a6 8bce            mov     ecx,esi
00007ff9`c81835a8 e833080000      call    CSRSRV!CsrParseServerCommandLine (00007ff9`c8183de0)
00007ff9`c81835ad 85c0            test    eax,eax
00007ff9`c81835af 0f8884390000    js      ·CSRSRV!guard_dispatch_icall_nop+0x2a9· (00007ff9`c8186f39)  ¡; <--- This is the call that reports an error!¡

CSRSRV!CsrServerInitialization+0x105:
00007ff9`c81835b5 8b151de20000    mov     edx,dword ptr [CSRSRV!CsrBaseTag (00007ff9`c81917d8)]
00007ff9`c81835bb 81c200000c00    add     edx,0C0000h
00007ff9`c81835c1 448b0500e10000  mov     r8d,dword ptr [CSRSRV!CsrTotalPerProcessDataLength (00007ff9`c81916c8)]
00007ff9`c81835c8 83ca08          or      edx,8
00007ff9`c81835cb 488b0dfee10000  mov     rcx,qword ptr [CSRSRV!CsrHeap (00007ff9`c81917d0)]
00007ff9`c81835d2 ff15c85b0000    call    qword ptr [CSRSRV!_imp_RtlAllocateHeap (00007ff9`c81891a0)]
00007ff9`c81835d8 4c8bc0          mov     r8,rax
00007ff9`c81835db 4885c0          test    rax,rax
00007ff9`c81835de 0f8464390000    je      CSRSRV!guard_dispatch_icall_nop+0x2b8 (00007ff9`c8186f48)

CSRSRV!CsrServerInitialization+0x134:
00007ff9`c81835e4 8bcb            mov     ecx,ebx
00007ff9`c81835e6 488d3d33e00000  lea     rdi,[CSRSRV!CsrLoadedServerDll (00007ff9`c8191620)]
00007ff9`c81835ed 4c8b0d14e00000  mov     r9,qword ptr [CSRSRV!CsrRootProcess (00007ff9`c8191608)]

CSRSRV!CsrServerInitialization+0x144:
00007ff9`c81835f4 83f906          cmp     ecx,6
00007ff9`c81835f7 7336            jae     CSRSRV!CsrServerInitialization+0x17f (00007ff9`c818362f)

CSRSRV!CsrServerInitialization+0x149:
00007ff9`c81835f9 8bc1            mov     eax,ecx
00007ff9`c81835fb 488b14c7        mov     rdx,qword ptr [rdi+rax*8]
00007ff9`c81835ff 4885d2          test    rdx,rdx
00007ff9`c8183602 7405            je      CSRSRV!CsrServerInitialization+0x159 (00007ff9`c8183609)

CSRSRV!CsrServerInitialization+0x154:
00007ff9`c8183604 395a40          cmp     dword ptr [rdx+40h],ebx
00007ff9`c8183607 750c            jne     CSRSRV!CsrServerInitialization+0x165 (00007ff9`c8183615)

CSRSRV!CsrServerInitialization+0x159:
00007ff9`c8183609 49899cc188000000 mov     qword ptr [r9+rax*8+88h],rbx
00007ff9`c8183611 ffc1            inc     ecx
00007ff9`c8183613 ebdf            jmp     CSRSRV!CsrServerInitialization+0x144 (00007ff9`c81835f4)

CSRSRV!CsrServerInitialization+0x165:
00007ff9`c8183615 4d8984c188000000 mov     qword ptr [r9+rax*8+88h],r8
00007ff9`c818361d 8b4240          mov     eax,dword ptr [rdx+40h]
00007ff9`c8183620 4983c007        add     r8,7
00007ff9`c8183624 4c03c0          add     r8,rax
00007ff9`c8183627 4983e0f8        and     r8,0FFFFFFFFFFFFFFF8h
00007ff9`c818362b ffc1            inc     ecx
00007ff9`c818362d ebc5            jmp     CSRSRV!CsrServerInitialization+0x144 (00007ff9`c81835f4)

CSRSRV!CsrServerInitialization+0x17f:
00007ff9`c818362f 895c2420        mov     dword ptr [rsp+20h],ebx
00007ff9`c8183633 83fb06          cmp     ebx,6
00007ff9`c8183636 732c            jae     CSRSRV!CsrServerInitialization+0x1b4 (00007ff9`c8183664)

CSRSRV!CsrServerInitialization+0x188:
00007ff9`c8183638 8bc3            mov     eax,ebx
00007ff9`c818363a 488b0cc7        mov     rcx,qword ptr [rdi+rax*8]
00007ff9`c818363e 4885c9          test    rcx,rcx
00007ff9`c8183641 7409            je      CSRSRV!CsrServerInitialization+0x19c (00007ff9`c818364c)

CSRSRV!CsrServerInitialization+0x193:
00007ff9`c8183643 488b4168        mov     rax,qword ptr [rcx+68h]
00007ff9`c8183647 4885c0          test    rax,rax
00007ff9`c818364a 7504            jne     CSRSRV!CsrServerInitialization+0x1a0 (00007ff9`c8183650)

CSRSRV!CsrServerInitialization+0x19c:
00007ff9`c818364c ffc3            inc     ebx
00007ff9`c818364e ebdf            jmp     CSRSRV!CsrServerInitialization+0x17f (00007ff9`c818362f)

CSRSRV!CsrServerInitialization+0x1a0:
00007ff9`c8183650 498bd1          mov     rdx,r9
00007ff9`c8183653 33c9            xor     ecx,ecx
00007ff9`c8183655 ff15955e0000    call    qword ptr [CSRSRV!_guard_dispatch_icall_fptr (00007ff9`c81894f0)]
00007ff9`c818365b 4c8b0da6df0000  mov     r9,qword ptr [CSRSRV!CsrRootProcess (00007ff9`c8191608)]
00007ff9`c8183662 ebe8            jmp     CSRSRV!CsrServerInitialization+0x19c (00007ff9`c818364c)

CSRSRV!CsrServerInitialization+0x1b4:
00007ff9`c8183664 eb00            jmp     CSRSRV!CsrServerInitialization+0x1b6 (00007ff9`c8183666)

CSRSRV!CsrServerInitialization+0x1b6:
00007ff9`c8183666 e875110000      call    CSRSRV!CsrSbApiPortInitialize (00007ff9`c81847e0)
00007ff9`c818366b 85c0            test    eax,eax
00007ff9`c818366d 0f88e9380000    js      CSRSRV!guard_dispatch_icall_nop+0x2cc (00007ff9`c8186f5c)

CSRSRV!CsrServerInitialization+0x1c3:
00007ff9`c8183673 4c8d0deedf0000  lea     r9,[CSRSRV!CsrSmApiPort (00007ff9`c8191668)]
00007ff9`c818367a 448b05d3990000  mov     r8d,dword ptr [CSRSRV!SessionFirstProcessImageType (00007ff9`c818d054)]
00007ff9`c8183681 488b1548e00000  mov     rdx,qword ptr [CSRSRV!CsrSbApiPort (00007ff9`c81916d0)]
00007ff9`c8183688 488d0d61e00000  lea     rcx,[CSRSRV!CsrSbApiPortName (00007ff9`c81916f0)]
00007ff9`c818368f ff15335e0000    call    qword ptr [CSRSRV!_imp_RtlConnectToSm (00007ff9`c81894c8)]
00007ff9`c8183695 85c0            test    eax,eax
00007ff9`c8183697 0f88ce380000    js      CSRSRV!guard_dispatch_icall_nop+0x2db (00007ff9`c8186f6b)

CSRSRV!CsrServerInitialization+0x1ed:
00007ff9`c818369d 33d2            xor     edx,edx
00007ff9`c818369f 488b4c2460      mov     rcx,qword ptr [rsp+60h]
00007ff9`c81836a4 ff15f65b0000    call    qword ptr [CSRSRV!_imp_NtResumeThread (00007ff9`c81892a0)]
00007ff9`c81836aa 85c0            test    eax,eax
00007ff9`c81836ac 0f88c8380000    js      CSRSRV!guard_dispatch_icall_nop+0x2ea (00007ff9`c8186f7a)

CSRSRV!CsrServerInitialization+0x202:
00007ff9`c81836b2 4533c0          xor     r8d,r8d
00007ff9`c81836b5 33d2            xor     edx,edx
00007ff9`c81836b7 488b4c2430      mov     rcx,qword ptr [rsp+30h]
00007ff9`c81836bc ff15ce5b0000    call    qword ptr [CSRSRV!_imp_NtWaitForSingleObject (00007ff9`c8189290)]
00007ff9`c81836c2 8bd8            mov     ebx,eax
00007ff9`c81836c4 488b4c2430      mov     rcx,qword ptr [rsp+30h]
00007ff9`c81836c9 ff15495b0000    call    qword ptr [CSRSRV!_imp_NtClose (00007ff9`c8189218)]
00007ff9`c81836cf 85db            test    ebx,ebx
00007ff9`c81836d1 0f88b2380000    js      CSRSRV!guard_dispatch_icall_nop+0x2f9 (00007ff9`c8186f89)

CSRSRV!CsrServerInitialization+0x227:
00007ff9`c81836d7 8b5c2428        mov     ebx,dword ptr [rsp+28h]
00007ff9`c81836db 85db            test    ebx,ebx
00007ff9`c81836dd 0f88b5380000    js      CSRSRV!guard_dispatch_icall_nop+0x308 (00007ff9`c8186f98)

CSRSRV!CsrServerInitialization+0x233:
00007ff9`c81836e3 c705f3e0000001000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],1
00007ff9`c81836ed 488d0dece00000  lea     rcx,[CSRSRV!CsrInitFailReason (00007ff9`c81917e0)]
00007ff9`c81836f4 ff159e5a0000    call    qword ptr [CSRSRV!_imp_RtlWakeAddressAll (00007ff9`c8189198)]

CSRSRV!CsrServerInitialization+0x24a:
00007ff9`c81836fa 8bc3            mov     eax,ebx

CSRSRV!CsrServerInitialization+0x24c:
00007ff9`c81836fc 488b5c2450      mov     rbx,qword ptr [rsp+50h]
00007ff9`c8183701 488b742458      mov     rsi,qword ptr [rsp+58h]
00007ff9`c8183706 4883c440        add     rsp,40h
00007ff9`c818370a 5f              pop     rdi
00007ff9`c818370b c3              ret

CSRSRV!guard_dispatch_icall_nop+0x252:
00007ff9`c8186ee2 48891d97a70000  mov     qword ptr [CSRSRV!CsrTraceHandle (00007ff9`c8191680)],rbx
00007ff9`c8186ee9 e90cc6ffff      jmp     CSRSRV!CsrServerInitialization+0x4a (00007ff9`c81834fa)

CSRSRV!guard_dispatch_icall_nop+0x25e:
00007ff9`c8186eee c705e8a8000002000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],2     ¡; <-- Look here! Fail reason is saved in a global var!!!¡
00007ff9`c8186ef8 e9ffc7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x26d:
00007ff9`c8186efd c705d9a8000003000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],3
00007ff9`c8186f07 e9f0c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x27c:
00007ff9`c8186f0c c705caa8000004000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],4
00007ff9`c8186f16 e9e1c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x28b:
00007ff9`c8186f1b c705bba8000005000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],5
00007ff9`c8186f25 e9d2c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x29a:
00007ff9`c8186f2a c705aca8000006000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],6
00007ff9`c8186f34 e9c3c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

·CSRSRV!guard_dispatch_icall_nop+0x2a9:·
00007ff9`c8186f39 c7059da8000007000000 mov dword ptr [·CSRSRV!CsrInitFailReason· (00007ff9`c81917e0)],·7·     ¡; <-- We will see that the value is 7; we could only get here by jumping to CSRSRV!guard_dispatch_icall_nop+0x2a9 ¡
00007ff9`c8186f43 e9b4c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x2b8:
00007ff9`c8186f48 c7058ea8000008000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],8
00007ff9`c8186f52 b8170000c0      mov     eax,0C0000017h
00007ff9`c8186f57 e9a0c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x2cc:
00007ff9`c8186f5c c7057aa800000b000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],0Bh
00007ff9`c8186f66 e991c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x2db:
00007ff9`c8186f6b c7056ba800000c000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],0Ch
00007ff9`c8186f75 e982c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x2ea:
00007ff9`c8186f7a c7055ca800000d000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],0Dh
00007ff9`c8186f84 e973c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24c (00007ff9`c81836fc)

CSRSRV!guard_dispatch_icall_nop+0x2f9:
00007ff9`c8186f89 c7054da800000e000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],0Eh
00007ff9`c8186f93 e962c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24a (00007ff9`c81836fa)

CSRSRV!guard_dispatch_icall_nop+0x308:
00007ff9`c8186f98 c7053ea800000f000000 mov dword ptr [CSRSRV!CsrInitFailReason (00007ff9`c81917e0)],0Fh
00007ff9`c8186fa2 e953c7ffff      jmp     CSRSRV!CsrServerInitialization+0x24a (00007ff9`c81836fa)

{% endhighlight %}

The function seems so long and tedious that one might lose heart in the entire endeavor of ever getting to the root of the crash. But wait till you get to the line number **202**! Here we must stop and thank Microsoft for kindly providing us with debug symbols for the entire set of OS modules. <!-- The benefits it brings to the craft of kernel-mode debugging can hardly be overestimated.--> The name "CSRSRV!CsrInitFailReason" is more than telling of its purpose -- it stores an error index indicating which part of the function has failed. Why, we should check its value! 


{% include code-block-header.html title="cdb: CSRSRV!CsrInitFailReason" %}
{% highlight none linenos %}

0: kd> dd CSRSRV!CsrInitFailReason
00007ff9`c81917e0  00000007 00000000 00000000 00000000

{% endhighlight %}

The value stored in _CSRSRV!CsrInitFailReason_ is 7. Using the trick with computing an offest for the case of `if (error) ProcessError()` pattern I showed earlier, we quickly identify the call to **_CSRSRV!CsrParseServerCommandLine_** in line **67** as the one ending in an error. Granted the role implied by this rather expressive function name, perhaps, it would be beneficial to take a look at the command line arguments passed to _csrss.exe_ before we plunge into decyphering the disassembly listings. It is achieved using **!peb** command.


{% include code-block-header.html title="cdb: Retrieving a Command Line" %}
{% highlight none linenos %}

0: kd> !peb
PEB at 00000023514db000
    InheritedAddressSpace:    No
    ReadImageFileExecOptions: No
    BeingDebugged:            No
    ImageBaseAddress:         00007ff6eb570000
    Ldr                       00007ff9cbfec360
    Ldr.Initialized:          Yes
    Ldr.InInitializationOrderModuleList: 0000014e4a403c90 . 0000014e4a4046c0
    Ldr.InLoadOrderModuleList:           0000014e4a403e00 . 0000014e4a4046a0
    Ldr.InMemoryOrderModuleList:         0000014e4a403e10 . 0000014e4a4046b0
                    Base TimeStamp                     Module
            7ff6eb570000 f4d5cd46 Mar 01 22:33:42 2100 C:\WINDOWS\system32\csrss.exe
            7ff9cbe90000 a5a334d4 Jan 22 06:48:52 2058 C:\WINDOWS\SYSTEM32\ntdll.dll
            7ff9c8180000 13fe2990 Aug 17 21:18:08 1980 C:\WINDOWS\SYSTEM32\CSRSRV.dll
    SubSystemData:     0000000000000000
    ProcessHeap:       0000014e4a200000
    ProcessParameters: 0000014e4a403300
    CurrentDirectory:  'C:\WINDOWS\system32\'
    WindowTitle:  '< Name not readable >'
    ImageFile:    'C:\WINDOWS\system32\csrss.exe'
    CommandLine:  '%SystemRoot%\system32\csrss.exe ObjectDirectory=\Windows SharedSection=1024,20480,768 Windows=On SubSystemType=Windows ServerDll=basesrv,1 ServerDll=winsrv:UserServerDllInitialization,3 ServerDll=sxssrv,4 ProfileControl=Off MaxRequestThreads=16'
    DllPath:      '< Name not readable >'
[...]

{% endhighlight %}

The command line in question is `%SystemRoot%\system32\csrss.exe ObjectDirectory=\Windows SharedSection=1024,20480,768 Windows=On SubSystemType=Windows ServerDll=basesrv,1 ServerDll=winsrv:UserServerDllInitialization,3 ServerDll=sxssrv,4 ProfileControl=Off MaxRequestThreads=16`. It is a well-formed command line without any syntactical errors as established by comparing to other Windows 10 instances, therefore the cause of the problem must lie somewhere else. Let us examine _CsrParseServerCommandLine_. 

I have read through the disassembly of _CsrParseServerCommandLine_ in an attempt to figure out what it was doing, but will not bore you with my "execution flow analysis". Instead, a source code of the matching function from [ReactOS](https://www.reactos.org/) will be provided; I copied the code from [here](https://doxygen.reactos.org/dd/dab/subsystems_2win32_2csrsrv_2init_8c_source.html). ReactOS has been designed to run Windows applications and drivers and as such is very similar in its architecture and implementation; however, one should not expect to find one-to-one correspondence between ReactOS and Windows code. In this particular case, I found it to be pretty close (but not an exact match!). 
 

{% include code-block-header.html title="ReactOS: CsrParseServerCommandLine()" %}
{% highlight c linenos %}

/*++
  * @name CsrParseServerCommandLine
  *
  * The CsrParseServerCommandLine routine parses the CSRSS command-line in the
  * registry and performs operations for each entry found.
  *
  * @param ArgumentCount
  *        Number of arguments on the command line.
  *
  * @param Arguments
  *        Array of arguments.
  *
  * @return STATUS_SUCCESS in case of success, STATUS_UNSUCCESSFUL otherwise.
  *
  * @remarks None.
  *
  *--*/
 NTSTATUS
 NTAPI
CsrParseServerCommandLine(IN ULONG ArgumentCount,
                           IN PCHAR Arguments[])
 {
     NTSTATUS Status;
     PCHAR ParameterName = NULL, ParameterValue = NULL, EntryPoint, ServerString;
     ULONG i, DllIndex;
     ANSI_STRING AnsiString;
     OBJECT_ATTRIBUTES ObjectAttributes;
 
     /* Set the Defaults */
     CsrTotalPerProcessDataLength = 0;
     CsrObjectDirectory = NULL;
     CsrMaxApiRequestThreads = 16;
 
     /* Save our Session ID, and create a Directory for it */
     SessionId = NtCurrentPeb()->SessionId;
     Status = CsrCreateSessionObjectDirectory(SessionId);
     if (!NT_SUCCESS(Status))
     {
         DPRINT1("CSRSS: CsrCreateSessionObjectDirectory failed (%lx)\n",
                 Status);
 
         /* It's not fatal if the session ID isn't zero */
         if (SessionId != 0) return Status;
         ASSERT(NT_SUCCESS(Status));
     }
 
     /* Loop through every argument */
     for (i = 1; i < ArgumentCount; i++)
     {
         /* Split Name and Value */
         ParameterName = Arguments[i];
         ParameterValue = NULL;
         ParameterValue = strchr(ParameterName, '=');
         if (ParameterValue) *ParameterValue++ = ANSI_NULL;
         DPRINT("Name=%s, Value=%s\n", ParameterName, ParameterValue);
 
         /* Check for Object Directory */
         if (_stricmp(ParameterName, "ObjectDirectory") == 0)
         {
             /* Check if a session ID is specified */
             if (SessionId != 0)
             {
                 DPRINT1("Sessions not yet implemented\n");
                 ASSERT(SessionId);
             }
 
             /* Initialize the directory name */
             RtlInitAnsiString(&AnsiString, ParameterValue);
             Status = RtlAnsiStringToUnicodeString(&CsrDirectoryName,
                                                   &AnsiString,
                                                   TRUE);
             ASSERT(NT_SUCCESS(Status) || SessionId != 0);
             if (!NT_SUCCESS(Status)) return Status;
 
             /* Create it */
             InitializeObjectAttributes(&ObjectAttributes,
                                        &CsrDirectoryName,
                                        OBJ_OPENIF | OBJ_CASE_INSENSITIVE | OBJ_PERMANENT,
                                        NULL,
                                        NULL);
             Status = NtCreateDirectoryObject(&CsrObjectDirectory,
                                              DIRECTORY_ALL_ACCESS,
                                              &ObjectAttributes);
             if (!NT_SUCCESS(Status)) return Status;
 
             /* Secure it */
             Status = CsrSetDirectorySecurity(CsrObjectDirectory);
             if (!NT_SUCCESS(Status)) return Status;
         }
         else if (_stricmp(ParameterName, "SubSystemType") == 0)
         {
             /* Ignored */
         }
         else if (_stricmp(ParameterName, "MaxRequestThreads") == 0)
         {
             Status = RtlCharToInteger(ParameterValue,
                                       0,
                                       &CsrMaxApiRequestThreads);
         }
         else if (_stricmp(ParameterName, "RequestThreads") == 0)
         {
             /* Ignored */
             Status = STATUS_SUCCESS;
         }
         else if (_stricmp(ParameterName, "ProfileControl") == 0)
         {
             /* Ignored */
         }
         else if (_stricmp(ParameterName, "SharedSection") == 0)
         {
             /* Create the Section */
             Status = CsrSrvCreateSharedSection(ParameterValue);
             if (!NT_SUCCESS(Status))
             {
                 DPRINT1("CSRSS: *** Invalid syntax for %s=%s (Status == %X)\n",
                         ParameterName, ParameterValue, Status);
                 return Status;
             }
 
             /* Load us */
             Status = CsrLoadServerDll("CSRSS" /* "CSRSRV" */, NULL, CSRSRV_SERVERDLL_INDEX);
         }
         else if (_stricmp(ParameterName, "ServerDll") == 0)
         {
             /* Loop the command line */
             EntryPoint = NULL;
             Status = STATUS_INVALID_PARAMETER;
             ServerString = ParameterValue;
             while (*ServerString)
             {
                 /* Check for the Entry Point */
                 if ((*ServerString == ':') && (!EntryPoint))
                 {
                     /* Found it. Add a nullchar and save it */
                     *ServerString++ = ANSI_NULL;
                     EntryPoint = ServerString;
                 }
 
                 /* Check for the Dll Index */
                 if (*ServerString++ == ',') break;
             }
 
             /* Did we find something to load? */
             if (!*ServerString)
             {
                 DPRINT1("CSRSS: *** Invalid syntax for ServerDll=%s (Status == %X)\n",
                         ParameterValue, Status);
                 return Status;
             }
 
             /* Convert it to a ULONG */
             Status = RtlCharToInteger(ServerString, 10, &DllIndex);
 
             /* Add a null char if it was valid */
             if (NT_SUCCESS(Status)) ServerString[-1] = ANSI_NULL;
 
             /* Load it */
             if (CsrDebug & 1) DPRINT1("CSRSS: Loading ServerDll=%s:%s\n", ParameterValue, EntryPoint);
             Status = CsrLoadServerDll(ParameterValue, EntryPoint, DllIndex);
             if (!NT_SUCCESS(Status))
             {
                 DPRINT1("CSRSS: *** Failed loading ServerDll=%s (Status == 0x%x)\n",
                         ParameterValue, Status);
                 return Status;
             }
         }
         else if (_stricmp(ParameterName, "Windows") == 0)
         {
             /* Ignored */
             // Check whether we want to start in pure GUI or pure CLI.
         }
         else
         {
             /* Invalid parameter on the command line */
             Status = STATUS_INVALID_PARAMETER;
         }
     }
 
     /* Return status */
     return Status;
 }

{% endhighlight %}

As we see, not only is this function responsible for parsing, it also, contrary to what its name suggests, performs the initialization steps specified by the command line arguments. Anything could have gone wrong here. Below is a quick survey of the command line options: 
* _ObjectDirectory_. Csrss calls NtCreateDirectoryObject() with whatever name follows the equal sign ("\Windows" in our case) supplied as a parameter.
* _SharedSection_ determines the sizes of system-wide and desktop heaps as well as the heap for non-interactive Windows entities such as services, according to [this article](https://www.ibm.com/support/knowledgecenter/en/SSZJPZ_11.7.0/com.ibm.swg.im.iis.productization.iisinfsv.install.doc/topics/wsisinst_config_winreg.html). 
* _Windows_, an "On/Off" switch, only determines how an integer CSRSRV!SessionFirstProcessImageType is initialized (here Windows 10 and ReactOS diverge) and does not generate any erros.
* _ServerDll_ entries specify dlls to load. I will elaborate on their role later. 
* _MaxRequestThreads_ value is simply recorded in CSRSRV!CsrMaxApiRequestThreads variable, so it should not cause any issues.
* _ProfileControl_ and _SubSystemType_ seem to be ignored.

A brief inspection of _CsrParseServerCommandLine()_ shows that the command line arguments are processed one by one with the routine terminating right away should the prosessing step fail, therefore, we must find the earliest of usucessful operations. So why don't we start with the first of the arguments? 

Below is an experpt from _CSRSRV!CsrParseServerCommandLine_ that handles the _ObjectDirectory_ parameter. 

{% include code-block-header.html title="CsrParseServerCommandLine : ObjectDirectory Handler" %}
{% highlight none linenos %}
[...]

00007ff9`c8183e08 48c7054dd8000000000000 mov qword ptr [CSRSRV!CsrObjectDirectory (00007ff9`c8191660)],0  ¡;<-- Initialization: CSRSRV!CsrObjectDirectory = 0¡ 
[...]

CSRSRV!CsrParseServerCommandLine+0x245:                                           ¡; Handler for "ObjectDirectory" starts here¡
00007ff9c8184025 mov     eax,dword ptr [CSRSRV!SessionId (00007ff9`c8191650)]
00007ff9c818402b lea     r9,[CSRSRV!`string' (00007ff9`c81897f8)]                 ¡; "%ws\%ld%s" (obtained by typing "da 00007ff9c81897f8")¡ 
00007ff9c8184032 mov     edx,100h
00007ff9c8184037 mov     qword ptr [rsp+30h],r14
00007ff9c818403c mov     dword ptr [rsp+28h],eax
00007ff9c8184040 lea     rcx,[rbp]
00007ff9c8184044 lea     rax,[CSRSRV!`string' (00007ff9`c8189808)]                ¡; "\" (obtained by typing "da 00007ff9c8189808")¡
00007ff9c818404b mov     qword ptr [rsp+20h],rax
00007ff9c8184050 lea     r8d,[rdx-1]
00007ff9c8184054 call    qword ptr [CSRSRV!_imp__snprintf_s (00007ff9`c8189210)]
00007ff9c818405a mov     eax,dword ptr [CSRSRV!ServiceSessionId (00007ff9`c81917e4)]
00007ff9c8184060 lea     rcx,[rsp+60h]
00007ff9c8184065 cmp     dword ptr [CSRSRV!SessionId (00007ff9`c8191650)],eax     ¡; Check CSRSRV!SessionId == CSRSRV!ServiceSessionId¡
00007ff9c818406b mov     ebx,0C0h
00007ff9c8184070 je      CSRSRV!CsrParseServerCommandLine+0x4dc (00007ff9`c81842bc)

CSRSRV!CsrParseServerCommandLine+0x296:
00007ff9c8184076 lea     rdx,[rbp]

CSRSRV!CsrParseServerCommandLine+0x29a:
00007ff9c818407a call    qword ptr [CSRSRV!_imp_RtlInitString (00007ff9`c8189258)]
00007ff9c8184080 lea     r14,[CSRSRV!CsrDirectoryName (00007ff9`c8191720)]
00007ff9c8184087 mov     r8b,1
00007ff9c818408a mov     rcx,r14
00007ff9c818408d lea     rdx,[rsp+60h]
00007ff9c8184092 call    qword ptr [CSRSRV!_imp_RtlAnsiStringToUnicodeString (00007ff9`c8189178)]
00007ff9c8184098 mov     r12d,eax
00007ff9c818409b test    eax,eax
00007ff9c818409d js      CSRSRV!CsrParseServerCommandLine+0x1c3 (00007ff9`c8183fa3) ¡;<-- Return an error¡

CSRSRV!CsrParseServerCommandLine+0x2c3:
00007ff9c81840a3 xorps   xmm0,xmm0
00007ff9c81840a6 mov     dword ptr [rsp+78h],30h
00007ff9c81840ae lea     r8,[rsp+78h]
00007ff9c81840b3 mov     qword ptr [rbp-80h],0
00007ff9c81840bb mov     edx,0F000Fh
00007ff9c81840c0 mov     dword ptr [rbp-70h],ebx
00007ff9c81840c3 lea     rcx,[CSRSRV!CsrObjectDirectory (00007ff9`c8191660)] ¡;<-- Address of  SRSRV!CsrObjectDirectory to be passed to NtCreateDirectoryObject¡
00007ff9c81840ca mov     qword ptr [rbp-78h],r14
00007ff9c81840ce movdqu  xmmword ptr [rbp-68h],xmm0
00007ff9c81840d3 call    qword ptr [CSRSRV!_imp_NtCreateDirectoryObject (00007ff9`c8189190)]
00007ff9c81840d9 mov     r12d,eax
00007ff9c81840dc test    eax,eax	
00007ff9c81840de js      CSRSRV!CsrParseServerCommandLine+0x1c3 (00007ff9`c8183fa3)  ¡;<-- Return an error¡

CSRSRV!CsrParseServerCommandLine+0x304:
00007ff9c81840e4 call    CSRSRV!CsrSetDirectorySecurity (00007ff9`c81865f0)
00007ff9c81840e9 mov     r12d,eax
00007ff9c81840ec test    eax,eax
00007ff9c81840ee js      CSRSRV!CsrParseServerCommandLine+0x1c3 (00007ff9`c8183fa3)  ¡;<-- Return an error¡

{% endhighlight %}

Notice that in the beginning variable `CSRSRV!CsrObjectDirectory` is initialized to NULL (line **3**) and then used to store a handle of the newly created directory object (lines **44** and **47**). Non-NULL `CSRSRV!CsrObjectDirectory` will imply that the call to _NtCreateDirectoryObject()_ has succeeded and, as we shall see in a moment it, indeed, has.

{% include code-block-header.html title="cdb: Checking if NtCreateDirectoryObject(\"\\Windows\") succeeded" %}
{% highlight none linenos %}

0: kd> dq CSRSRV!CsrDirectoryName
00007ff9`c8191720  00000000`00120010 0000014e`4a4048e0 ¡<-- UNICODE_STRING returned by AnsiToUnicodeString¡
00007ff9`c8191730  00007df4`f0630730 00000000`00000000
[...]
0: kd> du 0000014e`4a4048e0
0000014e`4a4048e0  "\Windows"

0: kd> dq CSRSRV!CsrObjectDirectory
00007ff9`c8191660  00000000`0000006c 00000000`00000000 ¡<-- NOT NULL!!!¡
[...]

{% endhighlight %}

A similar technique can be used to analyze _CsrSrvCreateSharedSection()_. Let us leave it alone for now and move to the "juicy bits".

### A Breakthrough

Now we move to the most interesting part -- processing of _ServerDll_ entries. Each _ServerDll_ gives a DLL name, index, and an optional name of a function to call ("ServerDllInitialization" is used by default). Again, for the sake of readability, I use [ReactOS code](https://doxygen.reactos.org/d1/db2/subsystems_2win32_2csrsrv_2server_8c_source.html) to accompany the verbal description, but, of course, one is advised to go over the disassembly listings to make sure the Windows and ReactOS implementations agree. 

{% include code-block-header.html title="ReactOS: CsrLoadServerDll()" %}
{% highlight c linenos %}

/*++
  * @name CsrLoadServerDll
  * @implemented NT4
  *
  * The CsrLoadServerDll routine loads a CSR Server DLL and calls its entrypoint.
  *
  * @param DllString
  *        Pointer to the CSR Server DLL to load and call.
  *
  * @param EntryPoint
  *        Pointer to the name of the server's initialization function.
  *        If this parameter is NULL, the default ServerDllInitialize
  *        will be assumed.
  *
  * @return STATUS_SUCCESS in case of success, STATUS_UNSUCCESSFUL otherwise.
  *
  * @remarks None.
  *
  *--*/
 NTSTATUS
 NTAPI
 CsrLoadServerDll(IN PCHAR DllString,
                  IN PCHAR EntryPoint OPTIONAL,
                  IN ULONG ServerId)
 {
     NTSTATUS Status;
     ANSI_STRING DllName;
     UNICODE_STRING TempString, ErrorString;
     ULONG_PTR Parameters[2];
     HANDLE hServerDll = NULL;
     ULONG Size;
     PCSR_SERVER_DLL ServerDll;
     STRING EntryPointString;
     PCSR_SERVER_DLL_INIT_CALLBACK ServerDllInitProcedure;
     ULONG Response;
 
     /* Check if it's beyond the maximum we support */
     if (ServerId >= CSR_SERVER_DLL_MAX) return STATUS_TOO_MANY_NAMES;
 
     /* Check if it's already been loaded */
     if (CsrLoadedServerDll[ServerId]) return STATUS_INVALID_PARAMETER;
 
     /* Convert the name to Unicode */
     ASSERT(DllString != NULL);
     RtlInitAnsiString(&DllName, DllString);
     Status = RtlAnsiStringToUnicodeString(&TempString, &DllName, TRUE);
     if (!NT_SUCCESS(Status)) return Status;
 
     /* If we are loading ourselves, don't actually load us */
     if (ServerId != CSRSRV_SERVERDLL_INDEX)
     {
         /* Load the DLL */
         Status = LdrLoadDll(NULL, 0, &TempString, &hServerDll);
         if (!NT_SUCCESS(Status))
         {
             /* Setup error parameters */
             Parameters[0] = (ULONG_PTR)&TempString;
             Parameters[1] = (ULONG_PTR)&ErrorString;
             RtlInitUnicodeString(&ErrorString, L"Default Load Path");
 
             /* Send a hard error */
             NtRaiseHardError(Status,
                              2,
                              3,
                              Parameters,
                              OptionOk,
                              &Response);
         }
 
         /* Get rid of the string */
         RtlFreeUnicodeString(&TempString);
         if (!NT_SUCCESS(Status)) return Status;
     }
 
     /* Allocate a CSR DLL Object */
     Size = sizeof(CSR_SERVER_DLL) + DllName.MaximumLength;
     ServerDll = RtlAllocateHeap(CsrHeap, HEAP_ZERO_MEMORY, Size);
     if (!ServerDll)
     {
         if (hServerDll) LdrUnloadDll(hServerDll);
         return STATUS_NO_MEMORY;
     }
 
     /* Set up the Object */
     ServerDll->Length = Size;
     ServerDll->SizeOfProcessData = 0;
     ServerDll->SharedSection = CsrSrvSharedSectionHeap; // Send to the server dll our shared heap pointer.
     ServerDll->Name.Length = DllName.Length;
     ServerDll->Name.MaximumLength = DllName.MaximumLength;
     ServerDll->Name.Buffer = (PCHAR)(ServerDll + 1);
     if (DllName.Length)
     {
         strncpy(ServerDll->Name.Buffer, DllName.Buffer, DllName.Length);
     }
     ServerDll->ServerId = ServerId;
     ServerDll->ServerHandle = hServerDll;
 
     /* Now get the entrypoint */
     if (hServerDll)
     {
         /* Initialize a string for the entrypoint, or use the default */
         RtlInitAnsiString(&EntryPointString,
                           EntryPoint ? EntryPoint : "ServerDllInitialization");
 
         /* Get a pointer to it */
         Status = LdrGetProcedureAddress(hServerDll,
                                         &EntryPointString,
                                         0,
                                         (PVOID)&ServerDllInitProcedure);
     }
     else
     {
         /* No handle, so we are loading ourselves */
         ServerDllInitProcedure = CsrServerDllInitialization;
         Status = STATUS_SUCCESS;
     }
 
     /* Check if we got the pointer, and call it */
     if (NT_SUCCESS(Status))
     {
         /* Get the result from the Server DLL */
         Status = ServerDllInitProcedure(ServerDll);
         if (NT_SUCCESS(Status))
         {
             /*
              * Add this Server's Per-Process Data Size to the total that each
              * process will need.
              */
             CsrTotalPerProcessDataLength += ServerDll->SizeOfProcessData;
 
             /* Save the pointer in our list */
             CsrLoadedServerDll[ServerDll->ServerId] = ServerDll;
 
             /* Does it use our generic heap? */
             if (ServerDll->SharedSection != CsrSrvSharedSectionHeap)
             {
                 /* No, save the pointer to its shared section in our list */
                 CsrSrvSharedStaticServerData[ServerDll->ServerId] = ServerDll->SharedSection;
             }
         }
     }
 
     if (!NT_SUCCESS(Status))
     {
         /* Server Init failed, unload it */
         if (hServerDll) LdrUnloadDll(hServerDll);
 
         /* Delete the Object */
         RtlFreeHeap(CsrHeap, 0, ServerDll);
     }
 
     /* Return to caller */
     return Status;
 }

{% endhighlight %}

Notice that in line **53** the DLL is loaded, in line **106** a pointer to the initialization function is retrieved, and in line **122** the latter is called with its return value recorded in the `Status` variable. Failing to load the DLL or locate the specified initialization function as well as that function returning an error 
will cause _CsrParseServerCommandLine()_ to terminate immediately without proceeding to deal with the rest of the command line arguments. Following this logic, it is suggested to consult the _csrss'_ list of loaded modules in order to determine which _ServerDll_ entries were actually processed. Among those, the last one will be a likely culprit. Hold on! But in the case of an error _CsrLoadServerDll_ unloads the DLL (see line **146**) and, thus, it will no longer be on the list. Luckily for us, Windows maintains a DLL load history. Being able to track down the unloaded modules is useful for debugging and plays a crucial role in memory forensics (and malware detection, in particular) as indicated in [this post](https://volatility-labs.blogspot.com/2013/05/movp-ii-22-unloaded-windows-kernel_22.html). 


{% include code-block-header.html title="cdb: List of Unloaded Modules" %}
{% highlight none linenos %}

0: kd> lm
start             end                 module name
00007ff6`eb570000 00007ff6`eb577000   csrss      (deferred)
00007ff9`c8180000 00007ff9`c8197000   CSRSRV     (deferred)
00007ff9`cbe90000 00007ff9`cc071000   ntdll      (pdb symbols)          d:\WinRestore\Symbols\ntdll.pdb
ffff8f49`c3200000 ffff8f49`c358f000   win32kfull   (deferred)
ffff8f49`c3590000 ffff8f49`c37c4000   win32kbase   (deferred)
ffff8f49`c4010000 ffff8f49`c408c000   win32k     (deferred)
fffff800`a6a09000 fffff800`a735c000   nt         (pdb symbols)          d:\WinRestore\Symbols\ntkrnlmp.pdb

[...]

Unloaded modules:
fffff808`9f640000 fffff808`9f64f000   dump_storport.sys
fffff808`9f9d0000 fffff808`9fd4d000   dump_iaStorA.sys
fffff808`9ffe0000 fffff808`9fffd000   dump_dumpfve.sys
fffff808`9e920000 fffff808`9e93c000   EhStorClass.sys
fffff808`a41a0000 fffff808`a41e8000   WUDFRd.sys
fffff808`a1cb0000 fffff808`a1cd5000   WudfPf.sys
fffff808`a0a20000 fffff808`a0a3b000   dam.sys
fffff808`9e230000 fffff808`9e240000   WdBoot.sys
fffff808`9f550000 fffff808`9f55f000   hwpolicy.sys
00007ff9`c8160000 00007ff9`c8174000   ·basesrv.DLL·        ¡;<--- Here it is !!!¡

{% endhighlight %}

**Lm** will give us a rather lenthy list of both loaded and unloaded modules; scroll down to the very end in order to find the latter. What do we see here? The only module found in the command line is **_basesrv_**. Take a note of the letter case: "basesrv" part is in lower case, exactly as it was specified in the command line; letters forming the ".DLL" postfix, on the other hand, are all capital, the reason being that the extension was added later, most likely, by _LdrLoadDll()_. There is a fairly good chance that _basesrv's DllInitializtion()_ routine returns an error thereby causing _csrss'_ untimely death. How do we check this hypothesis? Easy! Simply remove the `ServerDll=basesrv,1` substring from _csrss'_ command line and check if anything changes. 

{% capture alert-text %}
The reason the boot process terminates in a crash is to prevent potential data loss associated with running a faulty system. Tampering with Windows configuration in such an intrusive manner is asking for trouble, therefore, one is most insistently advised to backup his data before engaging in this dubious activity. In fact, the best thing to do is clone the entire sytem volume using Linux "dd" command, provided you have extra space to store the image.
{% endcapture %}
{% include warning-box.html text=alert-text %}

A quick research online will locate the place from where _csrss'_ command line is loaded: `HKEY_LOCAL_MACHINE\System\CurrentControlSet\Control\Session Manager\SubSystems\Windows`. All that remains to be done now is editing the registry value and rebooting the system (twice).

{% capture alert-text %}
In order to edit the registry use **_regedit_**'s "Load Hive" feature. Launch regedit, select HKEY_LOCAL_MACHINE, click on File&#8594;Load hive, navigate to `%SystemRoot%\System32\config\` and choose the file containing the hive you need to edit (HKLM\System, for example, can be found in `%SystemRoot%\System32\config\SYSTEM`). The content of this file will be loaded as a key in WinRE's HKLM hive. 
{% endcapture %}
{% include info-box.html text=alert-text %}

This time I got to congratulate myself on a fruitful application of my deductive skills as a BSOD presenting a new, different, message appeared on my screen. It read: "If you contact a support person, give them this info. Stop code: c0000142." It worked! To complete the picture, here is the _WinDbg_ crash dump analysis. 


{% include code-block-header.html title="cdb: Bugcheck Analysis #2" %}
{% highlight none linenos %}
2: kd> !analyze -v
*******************************************************************************
*                                                                             *
*                        Bugcheck Analysis                                    *
*                                                                             *
*******************************************************************************

Unknown bugcheck code (c0000142)
Unknown bugcheck description
Arguments:
Arg1: ffffbc892b3ceaa0
Arg2: ffffbc892a8d0f40
Arg3: 0000000000000000
Arg4: 0000000000000000

Debugging Details:
------------------


DUMP_CLASS: 1

DUMP_QUALIFIER: 401

BUILD_VERSION_STRING:  17134.1.amd64fre.rs4_release.180410-1804

[...]

ERROR_CODE: (NTSTATUS) 0xc0000142 - {DLL Initialization Failed}  Initialization of the dynamic link library %hs failed. The process is terminating abnormally. 

EXCEPTION_CODE: (NTSTATUS) 0xc0000142 - {DLL Initialization Failed}  Initialization of the dynamic link library %hs failed. The process is terminating abnormally.

EXCEPTION_CODE_STR:  c0000142

EXCEPTION_PARAMETER1:  ffffbc892b3ceaa0

EXCEPTION_PARAMETER2:  ffffbc892a8d0f40

EXCEPTION_PARAMETER3:  0000000000000000

EXCEPTION_PARAMETER4: 0

BUGCHECK_STR:  STATUS_DLL_INIT_FAILED

DUMP_TYPE:  1

BUGCHECK_P1: ffffbc892b3ceaa0

BUGCHECK_P2: ffffbc892a8d0f40

BUGCHECK_P3: 0

BUGCHECK_P4: 0

[...]

DEFAULT_BUCKET_ID:  WIN8_DRIVER_FAULT

PROCESS_NAME:  csrss.exe

CURRENT_IRQL:  0

ANALYSIS_SESSION_HOST:  MININT-UOAJD1C

ANALYSIS_SESSION_TIME:  01-26-2019 19:46:04.0503

ANALYSIS_VERSION: 10.0.14321.1024 amd64fre

LAST_CONTROL_TRANSFER:  from fffff80206328834 to fffff8020604b490

STACK_TEXT:
ffff9085`d05fe5a8 fffff802`06328834 : 00000000`0000004c 00000000`c0000142 ffff9085`d06a03f0 ffffe503`2f3e5690 : nt!KeBugCheckEx
ffff9085`d05fe5b0 fffff802`06321a70 : ffff9085`d05fe6d0 ffff9085`d05fe670 ffffffff`8000065c ffff9085`d05fe6d0 : nt!PopGracefulShutdown+0x294
ffff9085`d05fe5f0 fffff802`06314138 : 00000000`00000601 fffff802`00000006 00000000`00000004 00000000`0002001f : nt!PopTransitionSystemPowerStateEx+0xbab0
ffff9085`d05fe6b0 fffff802`0605bb43 : 00000000`00000000 fffff802`05f7a5c1 00000000`00000010 00000000`00000082 : nt!NtSetSystemPowerState+0x4c
ffff9085`d05fe880 fffff802`0604ee90 : fffff802`0648dba2 00000000`c0000004 ffffe503`26ebc300 ffffe503`2b217180 : nt!KiSystemServiceCopyEnd+0x13
ffff9085`d05fea18 fffff802`0648dba2 : 00000000`c0000004 ffffe503`26ebc300 ffffe503`2b217180 ffffe503`2b217140 : nt!KiServiceLinkage
ffff9085`d05fea20 fffff802`0648d7f9 : 00000000`00000000 ffffe503`26ebc3e0 ffffe503`2b217040 00000000`00000000 : nt!PopIssueActionRequest+0x292
ffff9085`d05feae0 fffff802`05fd4a5b : 00000000`00000001 00000000`00000002 ffffe503`26ebc300 00000000`00000000 : nt!PopPolicyWorkerAction+0x69
ffff9085`d05feb50 fffff802`05ef8e35 : ffffe503`2b217040 fffff802`05fd49e0 ffffe503`26ebc3e0 ffffe503`00002000 : nt!PopPolicyWorkerThread+0x7b
ffff9085`d05feb80 fffff802`05f154f7 : ffffe503`2b217040 00000000`00000080 ffffe503`26e9d440 ffffe503`2b217040 : nt!ExpWorkerThread+0xf5
ffff9085`d05fec10 fffff802`06052906 : ffffcc80`b5340180 ffffe503`2b217040 fffff802`05f154b0 00002000`00000080 : nt!PspSystemThreadStartup+0x47
ffff9085`d05fec60 00000000`00000000 : ffff9085`d05ff000 ffff9085`d05f9000 00000000`00000000 00000000`00000000 : nt!KiStartSystemThread+0x16


STACK_COMMAND:  kb

THREAD_SHA1_HASH_MOD_FUNC:  53fc5ecb280b3e5cc6b5dde02f8439c4d5c2f83b

THREAD_SHA1_HASH_MOD_FUNC_OFFSET:  e3dc0067092d83e33be59e48af344c9966c62572

THREAD_SHA1_HASH_MOD:  dc844b1b94baa204d070855e43bbbd27eee98b94

FOLLOWUP_IP:
nt!PopTransitionSystemPowerStateEx+bab0
fffff802`06321a70 cc              int     3

FAULT_INSTR_CODE:  687b89cc

SYMBOL_STACK_INDEX:  2

SYMBOL_NAME:  nt!PopTransitionSystemPowerStateEx+bab0

FOLLOWUP_NAME:  MachineOwner

MODULE_NAME: nt

IMAGE_NAME:  ntkrnlmp.exe

DEBUG_FLR_IMAGE_TIMESTAMP:  5ba316ae

BUCKET_ID_FUNC_OFFSET:  bab0

FAILURE_BUCKET_ID:  STATUS_DLL_INIT_FAILED_nt!PopTransitionSystemPowerStateEx

BUCKET_ID:  STATUS_DLL_INIT_FAILED_nt!PopTransitionSystemPowerStateEx

PRIMARY_PROBLEM_CLASS:  STATUS_DLL_INIT_FAILED_nt!PopTransitionSystemPowerStateEx

TARGET_TIME:  2019-01-27T03:07:24.000Z

OSBUILD:  17134

OSSERVICEPACK:  0

SERVICEPACK_NUMBER: 0

OS_REVISION: 0

SUITE_MASK:  784

PRODUCT_TYPE:  1

OSPLATFORM_TYPE:  x64

OSNAME:  Windows 10

OSEDITION:  Windows 10 WinNt TerminalServer SingleUserTS Personal

OS_LOCALE:

USER_LCID:  0

OSBUILD_TIMESTAMP:  2018-09-19 19:40:30

BUILDDATESTAMP_STR:  180410-1804

BUILDLAB_STR:  rs4_release

BUILDOSVER_STR:  10.0.17134.1.amd64fre.rs4_release.180410-1804

ANALYSIS_SESSION_ELAPSED_TIME: 11b4

ANALYSIS_SOURCE:  KM

FAILURE_ID_HASH_STRING:  km:status_dll_init_failed_nt!poptransitionsystempowerstateex

FAILURE_ID_HASH:  {3062d9f4-6d6b-6e95-3950-c5e344d01b2a}

Followup:     MachineOwner
---------
{% endhighlight %}

A DLL is failing to initilize, which should not surprise us for we have just stripped Windows subsystem of one of its key components, _basesrv.dll_. While a tempting prompt to dig deeper into the inner workings of Windows kernel, this error by itself is of no importance here for it will not contribute much to figuring out the reason behind the original crash. More interesting to us, is the loaded modules list. 


{% include code-block-header.html title="cdb: List of Unloaded Modules #2" %}
{% highlight none linenos %}

2: kd> lm
start             end                 module name
00007ff6`ad0c0000 00007ff6`ad0c7000   csrss      (deferred)
00007ffa`35010000 00007ffa`35027000   CSRSRV     (deferred)
00007ffa`38d20000 00007ffa`38f01000   ntdll      (pdb symbols)          d:\WinRestore\Symbols\ntdll.pdb
ffffe0df`81c00000 ffffe0df`81f8f000   win32kfull   (deferred)
ffffe0df`81fe0000 ffffe0df`8205c000   win32k     (deferred)
ffffe0df`82c20000 ffffe0df`82e54000   win32kbase   (deferred)
fffff802`05e16000 fffff802`05ea2000   hal        (deferred)
fffff802`05ea2000 fffff802`067f5000   nt         (pdb symbols)          d:\WinRestore\Symbols\ntkrnlmp.pdb

[...]

Unloaded modules:
fffff80e`76f80000 fffff80e`76f8f000   dump_storport.sys
fffff80e`77d60000 fffff80e`780dd000   dump_iaStorA.sys
fffff80e`78100000 fffff80e`7811d000   dump_dumpfve.sys
fffff80e`762e0000 fffff80e`762fc000   EhStorClass.sys
fffff80e`7ada0000 fffff80e`7ade8000   WUDFRd.sys
fffff80e`78ab0000 fffff80e`78ad5000   WudfPf.sys
fffff80e`765e0000 fffff80e`765fb000   dam.sys
fffff80e`765e0000 fffff80e`765f0000   WdBoot.sys
fffff80e`76e90000 fffff80e`76e9f000   hwpolicy.sys
00007ffa`34ff0000 00007ffa`35006000   ·winsrv.DLL·       ¡<--- Look! Windows went ahead and loaded winsrv.DLL¡
00007ffa`34fd0000 00007ffa`34fe4000   ·BASESRV.dll·      ¡<--- Something must have loaded BASESRV.dll, but notice the difference in letter case.¡ 
00007ffa`351f0000 00007ffa`35463000   kernelbase.dll

{% endhighlight %}

No longer stalled by the error in _basesrv's_ initialization routine, _csrss_ went ahead and attempted to load the next module on the list -- **_winsrv_** (notice the same letter case pattern with a combination of small and capital letters). An observant reader will have noticed that _basesrv.dll_ was also loaded and then unloaded, the difference in letter case suggesting it was done as a part of another use case scenario. It is reasonable to suggest that _winsrv.dll_ imports symbols from _basesrv_. Let us check this assumption using [pefile](https://github.com/erocarrera/pefile) python library by Ero Carrera.

{% include code-block-header.html title="winsrv.dll's Import List" %}
{% highlight python linenos %}

>>> import pefile
>>> pe = pefile.PE("winsrv.dll")
>>> for e in pe.DIRECTORY_ENTRY_IMPORT:
...     print(e.dll)
... 
ntdll.dll
CSRSRV.dll
BASESRV.dll
api-ms-win-core-errorhandling-l1-1-0.dll
api-ms-win-core-libraryloader-l1-2-0.dll
api-ms-win-core-processthreads-l1-1-0.dll
api-ms-win-core-profile-l1-1-0.dll
api-ms-win-core-sysinfo-l1-1-0.dll
api-ms-win-core-handle-l1-1-0.dll
api-ms-win-core-heap-l1-1-0.dll
api-ms-win-core-apiquery-l1-1-0.dll
api-ms-win-core-delayload-l1-1-1.dll
api-ms-win-core-delayload-l1-1-0.dll

{% endhighlight %}

Line **8** indicates that our assumption was correct. By now it is safe to declare that the experiment above has successfully confirmed our hypothesis, but to be on the safe side, let us run a quick final test to see if the command line was indeed modified the way we meant it. 

{% include code-block-header.html title="cdb: New Nommand Line for csrss" %}
{% highlight none linenos %}

2: kd> !peb
PEB at 00000093c6d50000
    InheritedAddressSpace:    No
    ReadImageFileExecOptions: No
    BeingDebugged:            No
    ImageBaseAddress:         00007ff6ad0c0000
    Ldr                       00007ffa38e7c360
    Ldr.Initialized:          Yes
    Ldr.InInitializationOrderModuleList: 0000024837403c70 . 00000248374046a0
    Ldr.InLoadOrderModuleList:           0000024837403de0 . 0000024837404680
    Ldr.InMemoryOrderModuleList:         0000024837403df0 . 0000024837404690
                    Base TimeStamp                     Module
            7ff6ad0c0000 f4d5cd46 Mar 01 22:33:42 2100 C:\WINDOWS\system32\csrss.exe
            7ffa38d20000 a5a334d4 Jan 22 06:48:52 2058 C:\WINDOWS\SYSTEM32\ntdll.dll
            7ffa35010000 13fe2990 Aug 17 21:18:08 1980 C:\WINDOWS\SYSTEM32\CSRSRV.dll
    SubSystemData:     0000000000000000
    ProcessHeap:       00000248373e0000
    ProcessParameters: 0000024837403300
    CurrentDirectory:  'C:\WINDOWS\system32\'
    WindowTitle:  '< Name not readable >'
    ImageFile:    'C:\WINDOWS\system32\csrss.exe' ¡;Take a look at the command line below. No basesrv!¡
    CommandLine:  '%SystemRoot%\system32\csrss.exe ObjectDirectory=\Windows SharedSection=1024,20480,768 Windows=On SubSystemType=Windows ·ServerDll=winsrv:UserServerDllInitialization,3 ServerDll=sxssrv,4· ProfileControl=Off MaxRequestThreads=16'

{% endhighlight %}

The `CommandLine` field does not contain any references to _basesrv_ leaving no doubt about validity of our conclusion.

## Conclusion

In this article I walked you, my dear reader, though the steps taken to diagnose a critical error in Window boot process using a command line debugger from Debugging Tools for Windows and crash dumps. We have come a long way. Commencing with a standard bug check analysis, we traced back the execution path by navigating through a maze of offsets and jumps, then meticulously examined a stack dump to fish out the error code, scrutinized subroutines one by one to figure out (based on side effects only) which might be at the heart of the issue, employed a clever trick to identify the faulty DLL, and, finally, designed an experiment to test our hypothesis. I hope, it made for an entertaining journey.

In the end, we were able to localize the issue to a particular function. It turns out, the function _ServerDllInitialization()_ exported by _basesrv.dll_ returns `STATUS_OBJECT_NAME_NOT_FOUND` error code thereby causing a critical Windows process, _csrss.exe_, to terminate.

Further investigation is left for parts [2]({{ site.baseurl }}/systems%20blog/ServerDllInitialization-reversing) and [3]({{ site.baseurl }}/systems%20blog/Registry-Recovery).

Until then, stay healthy, stay happy, and stay proficient.

--Ry Auscitte :-)

