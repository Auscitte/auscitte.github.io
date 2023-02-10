---
layout: post
title: Using WinSxS to Retrace Windows Update History
author: Ry Auscitte
category: systems blog
comments: true
description: Describes the part WinSxS plays in installation of differential compression-based Windows updates. Introduces a python script that reconstructs an update history for a given file by enumerating WinSxS entries and establishing sequences of delta patches.

tags:
    - WinSxS
    - differential update
    - Windows
uses_math: false
---

## Introduction

Should one be asked about `%windir%\WinSxS`, the first thing springing to mind is "a place to look for a specific version of some library" for this is the directory utilized by the **_WinSxS_** (Windows side-by-side assembly) technology designed to solve the .dll isolation problem (which, in broader terms, is referred to as _DLL hell_). Whether **_WinSxS_** is effective in accomplishing this goal is a topic for another discussion (a discussion one can get prepared for by reading [this][winsxs] remarkably well-written blog post), but if there are multiple versions of the same component in the system, they are likely to reside in `%windir%\WinSxS`. 

With the introduction of a new type of Windows updates, another use case for the directory emerged. Unlike the "delta compression of the past" facilitating the efficiency of _express updates_, the type of _differential compression_ adopted recently cannot decompress the file on-site based solely on its previous version and a delta -- it requires an additional piece of data that goes by the name of _reverse differential_. The latter, along with the file to be updated, is stored `%windir%\WinSxS`.

I intentionally refer to the item being decompressed by a general term of "file" since modules are not the only OS constituents that need updating. For one, the purpose behind looking into the new update technology on my part was to recover old versions of `dbxupdate.bin` (for [this project]({% post_url 2023-02-10-Dbxupdate-Parse %})), which is not an executable image at all, but a binary file containing a new value of an NVRAM variable pertaining to _secure boot_. Working on the project, I succumbed to the vice of excessive automation and wrote a [python script](https://github.com/Auscitte/sys-utils/blob/main/win_read_winsxs.py) that would traverse the `%windir%\WinSxS` folder listing all available versions of a given file together with other, potentially useful, information. The way I see it (and, no doubt, a fair number of people will share the sentiment): why spend two minutes running a search over the file system when the task can be automated in under 24 hours? 

In this post, I am presenting a few bits and bobs concerning _WinSxS_ structure and its use in Windows updates I learned while implementing the utility. 

## Useful Links

Not intended as a fully-fledged article, this work, while assuming familiarity with _WinSxS_ and Windows updates, does not provide sufficient information on the subject, even in the form of an overview. Instead, the reader is referred to the sources listed below.
* The _WinSxS_ technology, its raison d'être and operation specifics, are described in [this post][winsxs]. 
* The new type of Window updates that involve an application of reverse and forward differentials is introduced in [this whitepaper][diff-whitepaper].
* Notes on differential compression and internal organization of Windows update packages (.msu) can be found in [this post][diff-patch] by Jaime Geiger ([one of my posts]({% post_url 2023-02-10-Dbxupdate-Parse %}#on-the-anatomy-of-windows-updates) also touches upon the subject). 

## Theory

The structure of `%windir%\WinSxS` would be an apt starting point of this little discourse; while there are subdirectories of functional significance in `WinSxS`, let us focus on the entries that correspond to assemblies themselves. The term **_assembly_** will be used in the most general sense as "_a collection of resources with a manifest_" (the definition courtesy of [omnicognate][winsxs]), which is perfectly illustrated by the _amd64_microsoft-windows-userexperience-desktop\_<wbr/>31bf3856ad364e35\_<wbr/>10.0.19041.1741\_<wbr/>none\_<wbr/>fb3f58b37ea27c55_ assembly. Take a look at the files ("resources") the assembly contains (subfolders pertaining to updates: `.\f`, `.\r`, `.\n` - are omitted).

{% include code-block-header.html title="microsoft-windows-userexperience-desktop files" %}
{% highlight none linenos %}
AppListBackup.dll
AppxBlockmap.xml
AppxManifest.xml
AppxSignature.p7x
Assets\BadgeLogo.scale-100.png
Assets\BadgeLogo.scale-125.png
Assets\BadgeLogo.scale-150.png
Assets\BadgeLogo.scale-200.png
Assets\BadgeLogo.scale-400.png
Assets\Dictation\default.css
Assets\Dictation\index.html
Assets\Fonts\AXPMDL2.ttf
Assets\Fonts\CloudAnimation.ttf
Assets\Fonts\ECMDL2.ttf
Assets\Fonts\ESIPMDL2.ttf
Assets\Fonts\GetSMDL.ttf
Assets\Fonts\HandwritingMixedInput.ttf
Assets\KbdAccentPicker.wav
Assets\KbdFunction.wav
Assets\KbdKeyTap.wav
Assets\KbdSpacebar.wav
Assets\KbdSwipeGesture.wav
Assets\LockScreenLogo.scale-200.png
Assets\Ninja\CategorySticker.png
Assets\SplashScreen.scale-100.png
Assets\SplashScreen.scale-125.png
Assets\SplashScreen.scale-150.png
Assets\SplashScreen.scale-200.png
Assets\SplashScreen.scale-400.png
Assets\Square150x150Logo.scale-200.png
Assets\Square44x44Logo.scale-200.png
Assets\Square44x44Logo.targetsize-24_altform-unplated.png
Assets\SquareLogo150x150.scale-100.png
Assets\SquareLogo150x150.scale-200.png
Assets\SquareLogo150x150.scale-400.png
Assets\SquareLogo310x310.scale-100.png
Assets\SquareLogo310x310.scale-200.png
Assets\SquareLogo310x310.scale-400.png
Assets\SquareLogo44x44.scale-100.png
Assets\SquareLogo44x44.scale-200.png
Assets\SquareLogo44x44.scale-400.png
Assets\SquareLogo71x71.scale-100.png
Assets\SquareLogo71x71.scale-200.png
Assets\SquareLogo71x71.scale-400.png
Assets\StoreLogo.png
Assets\StoreLogo.scale-100.png
Assets\StoreLogo.scale-125.png
Assets\StoreLogo.scale-150.png
Assets\StoreLogo.scale-200.png
Assets\StoreLogo.scale-400.png
Assets\Wide310x150Logo.scale-200.png
Assets\WideLogo310x150.scale-100.png
Assets\WideLogo310x150.scale-200.png
Assets\WideLogo310x150.scale-400.png
InputApp.dll
InputApp\Assets\BadgeLogo.scale-100.png
InputApp\Assets\BadgeLogo.scale-125.png
InputApp\Assets\BadgeLogo.scale-150.png
InputApp\Assets\BadgeLogo.scale-200.png
InputApp\Assets\BadgeLogo.scale-400.png
InputApp\Assets\Fonts\AXPMDL2.ttf
InputApp\Assets\Fonts\CloudAnimation.ttf
InputApp\Assets\Fonts\ECMDL2.ttf
InputApp\Assets\Fonts\ESIPMDL2.ttf
InputApp\Assets\Fonts\GetSMDL.ttf
InputApp\Assets\Fonts\HandwritingMixedInput.ttf
InputApp\Assets\KbdAccentPicker.wav
InputApp\Assets\KbdFunction.wav
InputApp\Assets\KbdKeyTap.wav
InputApp\Assets\KbdSpacebar.wav
InputApp\Assets\KbdSwipeGesture.wav
InputApp\Assets\Ninja\CategorySticker.png
InputApp\Assets\SplashScreen.scale-100.png
InputApp\Assets\SplashScreen.scale-125.png
InputApp\Assets\SplashScreen.scale-150.png
InputApp\Assets\SplashScreen.scale-200.png
InputApp\Assets\SplashScreen.scale-400.png
InputApp\Assets\SquareLogo150x150.scale-100.png
InputApp\Assets\SquareLogo150x150.scale-200.png
InputApp\Assets\SquareLogo150x150.scale-400.png
InputApp\Assets\SquareLogo310x310.scale-100.png
InputApp\Assets\SquareLogo310x310.scale-200.png
InputApp\Assets\SquareLogo310x310.scale-400.png
InputApp\Assets\SquareLogo44x44.scale-100.png
InputApp\Assets\SquareLogo44x44.scale-200.png
InputApp\Assets\SquareLogo44x44.scale-400.png
InputApp\Assets\SquareLogo71x71.scale-100.png
InputApp\Assets\SquareLogo71x71.scale-200.png
InputApp\Assets\SquareLogo71x71.scale-400.png
InputApp\Assets\StoreLogo.scale-100.png
InputApp\Assets\StoreLogo.scale-125.png
InputApp\Assets\StoreLogo.scale-150.png
InputApp\Assets\StoreLogo.scale-200.png
InputApp\Assets\StoreLogo.scale-400.png
InputApp\Assets\WideLogo310x150.scale-100.png
InputApp\Assets\WideLogo310x150.scale-200.png
InputApp\Assets\WideLogo310x150.scale-400.png
IrisService.dll
LayoutData.dll
LayoutData.winmd
ScreenClipping.dll
ScreenClipping.winmd
ScreenClippingHost.exe
ScreenClipping\Assets\Fonts\strgmdl2.2.42.ttf
ScreenClipping\Assets\LockScreenLogo.scale-200.png
ScreenClipping\Assets\Sounds\camerashutter.wav
ScreenClipping\Assets\SplashScreen.scale-200.png
ScreenClipping\Assets\Square150x150Logo.scale-200.png
ScreenClipping\Assets\Square44x44Logo.scale-200.png
ScreenClipping\Assets\Square44x44Logo.targetsize-24_altform-unplated.png
ScreenClipping\Assets\StoreLogo.png
ScreenClipping\Assets\Wide310x150Logo.scale-200.png
SuggestionUI.dll
SuggestionUI.winmd
TextInput.dll
TextInput.winmd
TextInputCommon.dll
TextInputCommon.winmd
TextInputHost.exe
concrt140_app.dll
msvcp140_1_app.dll
msvcp140_2_app.dll
msvcp140_app.dll
msvcp140_codecvt_ids_app.dll
resources.pri
vcamp140_app.dll
vccorlib140_app.dll
vcomp140_app.dll
vcruntime140_1_app.dll
vcruntime140_app.dll
{% endhighlight %}

The assembly is characterized by a relatively complex internal structure, with multiple levels of subdirectories holding files of various kinds: dynamic-link libraries, fonts, graphic and audio files, etc. To complete the picture, there is a matching manifest file in `%windir%\WinSxS\Manifests` (manifests can be decompressed using [this utility][wcpex]).

{% include code-block-header.html title="microsoft-windows-userexperience-desktop manifest" %}
{% highlight xml linenos %}
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<assembly xmlns = "urn:schemas-microsoft-com:asm.v3" 
          manifestVersion = "1.0" 
          copyright = "Copyright (c) Microsoft Corporation. All Rights Reserved.">

    <assemblyIdentity name = "Microsoft-Windows-UserExperience-Desktop"
                      version = "10.0.19041.2311"
                      processorArchitecture = "amd64"
                      language = "neutral"
                      buildType = "release"
                      publicKeyToken = "31bf3856ad364e35"
                      versionScope = "nonSxS" />

    <file name = "AppListBackup.dll" 
          destinationPath = "$(runtime.windows)\SystemApps\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\" 
          sourceName = "" 
          importPath = "$(build.nttree)\WindowsUserExperience.Desktop\">
	
        <securityDescriptor name = "WRP_FILE_DEFAULT_SDDL" />
	
        <asmv2:hash xmlns:asmv2 = "urn:schemas-microsoft-com:asm.v2" 
                    xmlns:dsig = "http://www.w3.org/2000/09/xmldsig#">
	
            <dsig:Transforms>
                <dsig:Transform Algorithm = "urn:schemas-microsoft-com:HashTransforms.Identity" />	
            </dsig:Transforms>
	
            <dsig:DigestMethod Algorithm = "http://www.w3.org/2000/09/xmldsig#sha256" />
	
            <dsig:DigestValue>uuxnXwPnRozKyXgN2x6hsNkTS4G70fhsTaUXHG2bkvE=</dsig:DigestValue>
	
        </asmv2:hash>
    </file>
<!-- [...] -->
</assembly>	
{% endhighlight %}

Its manifest is what establishes an _identity_ for the assembly. In [his post][winsxs-names], Jon Wiswall defines an assembly **_identity_** as "_a property
bag of string triplets - namespace, name, and value - for each attribute_", then goes on to describe the way the identity translates into a unique name for the directory where the assembly resources are stored. The folder name being necessarily unique, one can talk about a _key form_ of assembly identity generated based on the assembly attributes. The **_key form_** is structured as follows:
{% highlight none linenos %}
<cpu arch>_<assembly name>_<public key token>_<version>_<locale>_<identity hash>
{% endhighlight %}
Obviously, **_&lt;cpu arch&gt;_** is a CPU architecture; among possible values one can find, expectedly, `x86`, `amd64`, `arm`, `arm64`, `msil`, and, surprisingly, `wow64`. The latter has to do with emulation of 32-bit code on 64-bit platforms, the task performed by the _WoW64_ (why it requires a separate _&lt;cpu arch&gt;_ is, although an interesting question, sadly, outside the scope of this work). **_&lt;public key token&gt;_** holds the last 8 bytes (written in hexadecimal format) of the _sha1_ hash of the public key complementing the private key used to sign the assembly. **_&lt;version&gt;_**, a quadruplet `<major>.<minor>.<build>.<revision>`, represents the assembly version. **_&lt;locale&gt;_** corresponds to a notion known by many different names: "locale", "culture", or, simply, "language" (for example, `en-us`); when an assembly is language-agnostic, the `none` placeholder is used. 

A careful examination of the manifest will convince the reader that only a subset of assembly attributes is used to generate its _key form_, hence there arises the problem of ensuring key forms' uniqueness, a problem that is solved by appending an 8 byte-long hash of the assembly identity written in hexadecimal notation (at the time of writing, the hashing algorithm remains undisclosed). The fact that Microsoft chose to err on the side of caution means that repeats in the values of _&lt;assembly name&gt;_ are possible; however, this attribute is still likely to be different for the assemblies different in the functionality they provide and, for the sake of simplicity, my script will treat it as such.

Now that we have established what the assembly identity is and how it translates into the folder names in `%windir%\WinSxS`, let us consider the same, but from the versioning standpoint. It seems reasonable to treat _&lt;assembly name&gt;_ as a "unit of functionality" by assuming that two assemblies sharing _&lt;assembly name&gt;_ implement the same functionality. Taking the assumption a step further, two assemblies with the same _&lt;assembly name&gt;_, but different _&lt;cpu arch&gt;_, are designed to perform the same function, but on different platforms. Likewise, two assemblies sharing an _&lt;assembly name&gt;_, but not _&lt;locale&gt;_, differ in that their textual data (such as string tables in DLLs) are in two different languages. Equally reasonable it is to assume that several language- and architecture-specific variants of the same assembly are simultaneously present in the system (e.g. 32-bit and 64-bit versions of the same application), hence each triplet (_&lt;assembly name&gt;_, _&lt;cpu arch&gt;_, _&lt;locale&gt;_) should be versioned independently and, consequently, separate updates should be issued for each such triplet. The latter affects the way update histories are reconstructed, which brings us to the next topic in this discussion, installation of differential-compression-based updates.

The technology Microsoft refers to as "express updates" has been superseded by updates of a new type. Binary deltas included in express update packages were computed based on the latest version of the files, subject to the update, residing on the computer. As a result, a large number of update packages, one for each possible combination of files' versions, had to be computed. With the new update technology, deltas are computed relative to a common base version of the assembly being updated. For details, the reader is referred to [this whitepaper][diff-whitepaper]; presented here is only an overview of this technique.

{% capture alert-text %}
I will describe the process in terms of assemblies; it is important to keep in mind that an update package may modify only some resources within an assembly or multiple assemblies at the same time.
{% endcapture %}
{% include note-box.html text=alert-text %}

To begin with, let us suppose for a moment that the update package is installing a hitherto non-existent assembly; in this case, it will include so-called **_null differentials_** for each "resource" file, which amount to nothing more than these files compressed using an ordinary lossless compression algorithm. The update installer will create an assembly's identity key form-named subdirectory in `%windir%\WinSxS` holding the decompressed files along with the _null differentials_ used to generate them. The latter are placed in a subfolder named `n`. This version of the assembly will be considered a **_base version_**. This is not the only way an assembly's **_base version_** could be brought into existence. It may also arrive in a setup for a major OS release or come along with the computer, preinstalled by the manufacturer; naturally, there will be no _null differentials_ in `WinSxS` in this case. 

Now consider a package updating some assembly already present in the system. Such a package will contain so-called _forward differentials_ (one per every "resource" file being updated). A **_forward differential_** is a delta that, when applied to a _base version_ of the assembly, will produce the desired, updated, files. If the _base version_ is the thing being updated, then we are golden. When, however, the assembly is "at an advanced version" and the initial, base, variant is long gone, _forward differentials_ are not applicable directly; in this case, the assembly must be accompanied by _reverse differentials_. The update installer, having located the latest assembly in `WinSxS`, will find stored as part of it, in a subdirectory named `r`, a set of _reverse differentials_. A **_reverse differential_** is a difference (in terms of _differential compression_) between a file base and its current version, thereby it becomes possible to recover a _base version_ of the assembly and then go from there. 

I will illustrate the process by an example (should this one be insufficient, there is another, a real-life, example [here]({% post_url 2023-02-10-Dbxupdate-Parse %}#on-the-anatomy-of-windows-updates)). Say, there is an update package intended to advance the file `library.dll` from its current revision 42 to revision 43; in order to accomplish it, the package must contain, among other files, a manifest describing the new "incarnation" of the assembly, a _forward differential_ calculated as a difference between the 43th and first revisions of `library.dll` (i.e. `x.x.x.1 + <forward differential> = x.x.x.43`) and, though it is not strictly necessary to carry out the update, a _reverse differential_, which is the same as its "forward" counterpart, but "with an opposite sign", so to speak (i.e. `x.x.x.43 + <reverse differential> = x.x.x.1`). This _reverse differential_ will make it possible to install the next update to `library.dll`. The diagram below shows how various versions of `library.dll` and the accompanying differentials are related.

{% include orig-size-centered-fig.html filename="winsxs_update.png" alt="?" %}

Here is an approximate sequence of steps involved in installing the update:
1. With the help of enclosed manifest, the installer locates the current version of `library.dll` (marked by a revision number of 42) in `WinSxS` and in the same directory -- the subdirectory `r` containing a _reverse differential_. 
1. The _reverse differential_ `%windir%\WinSxS\x86_..._x.x.x.42_...\r\library.dll` is then applied to `library.dll` in order to reconstruct its _base version_ (we assume its revision number to be 1).
1. The installer decompresses a new version of `library.dll` (rev. 43) by applying the _forward differential_ extracted from the update package to the _base version_ of this file generated at step 2.
1. A new directory in `WinSxS` is created and the decompressed file along with the forward and reverse differentials **_from the update package_** are copied there (into the `f` and `r` subdirectories respectively).
1. Auxiliary steps required to create a new assembly (such as placing its manifest in the `Manifests` subfolder) are performed. 

Note that both reverse and forward differentials that come in the update package are saved in `WinSxS`. The _reverse differential_, of course, will come in handy when the next update package arrives. Whether Windows has any use for the _forward differential_, apart from that of a keepsake, a perfect reminder of the glorious updates gone by, I have not yet figured out, but it will be utilized by my script to retrace the update history (which is what we are going to discuss next). 

## Demonstration

The reason I needed a script traversing `%windir%\WinSxS` in the first place was to recover earlier versions of a particular file, `dbxupdate.bin`, so this became its primary use case (although, it also allows for dumping the entire content of `WinSxS`). The algorithm identifies all the assemblies containing a given file and, for each value of tuple (_&lt;assembly name&gt;_, _&lt;cpu arch&gt;_, _&lt;locale&gt;_), builds a sequence of versions, while checking that the sequence elements, indeed, belong to the same file by leveraging reverse and forward differentials. The latter is accomplished with the help of Jaime Geiger's [utility](https://gist.github.com/wumb0/9542469e3915953f7ae02d63998d2553), which, in turn, employs Microsoft **_Delta Compression API_** to apply differentials meaning that its use (and, consequently, that of my module) is limited to Windows. The _Delta Compression API_ seems to come equipped with a safeguard against improper application of differentials. Pass a wrong (i.e. computed for a file other than the one in the input buffer) differential to `ApplyDeltaB()` and, in all probability, the function will fail, with `GetLastError()` returning 13 (which translates into the "The data is invalid" message). This feature is what enables my script to perform the check. What it cannot check is whether the file sequence is contiguous (due to the fact that deltas are computed relative to a base and not the most recent version of the file). Assembly's _version_ attribute is of no help here either since more often than not there would be a gap in revision numbers, even between two **_consecutive_** updates to the same file.

To see the [script](https://github.com/Auscitte/sys-utils/blob/main/win_read_winsxs.py) in action, let us launch it passing, say, `shlwapi.dll` as a parameter.

{% include code-block-header.html title="win_read_winsxs's output for shlwapi.dll" %}
{% highlight none linenos %}
>python win_read_winsxs.py -f shlwapi.dll

microsoft-windows-shlwapi (arch = amd64, locale = none)
~~~~~~~~~~~~~~
microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: amd64
         ver: 10.0.19041.1706
         ts: Fri May 13 18:30:55 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 6e6374325a0e351e

microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: amd64
         ver: 10.0.19041.2075
         ts: Thu Dec 15 07:58:23 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 6eb63e5a59cf066e


shlwapi.dll: 10.0.19041.1706 <==> 10.0.19041.2075


microsoft-windows-shlwapi (arch = wow64, locale = none)
~~~~~~~~~~~~~~
microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: wow64
         ver: 10.0.19041.1706
         ts: Fri May 13 18:31:31 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 78b81e848e6ef719

microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: wow64
         ver: 10.0.19041.2075
         ts: Thu Dec 15 08:01:05 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 790ae8ac8e2fc869


shlwapi.dll: 10.0.19041.1706 <==> 10.0.19041.2075
{% endhighlight %}

`shlwapi.dll` was found among resources of the `microsoft-windows-shlwapi` assembly; of the latter, there are two variants: for `amd64` and `wow64`. Each variant exists in two versions: `10.0.19041.1706` and `10.0.19041.2075` (the base version was not preserved) amounting to four different "renditions" of `shlwapi.dll`. `shlwapi.dll`, revision 2075 is derived from `shlwapi.dll`, revision 1706 by a successive application of first reverse and then forward differentials (as indicated by a `<==>` symbol).   

Allow me to demonstrate this process in detail. But first, let us get acquainted with the classes defined in **_win_read_winsxs_** by replicating the output above.

{% highlight python linenos %}
>>> from win_read_winsxs import WinSxS, WinSxSFileId, Sequence
>>> wss = WinSxS()
>>> fid = WinSxSFileId("wow64", "none", "microsoft-windows-shlwapi", "shlwapi.dll")
>>> wss.versioned_files[fid]
[microsoft-windows-shlwapi, microsoft-windows-shlwapi]
>>> lst = wss.versioned_files[fid]
>>> print(*lst, sep = "\n")
microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: wow64
         ver: 10.0.19041.1706
         ts: Fri May 13 18:31:31 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 78b81e848e6ef719
microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: wow64
         ver: 10.0.19041.2075
         ts: Thu Dec 15 08:01:05 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 790ae8ac8e2fc869

>>> print(Sequence(lst, 'shlwapi.dll'))
shlwapi.dll: 10.0.19041.1706 <==> 10.0.19041.2075
{% endhighlight %}

We begin by applying the _reverse differential_ stored alongside `shlwapi.dll`, version `10.0.19041.1706`. 

{% highlight python linenos %}
>>> from win_read_winsxs import apply_differential_to_file
>>> buf = apply_differential_to_file(lst[0].get_file_path('shlwapi.dll'),
...                                  lst[0].get_rev_path('shlwapi.dll'))
>>> with open('shlwapi_current_base.dll', 'wb') as f:
...     f.write(buf)
...
275280
{% endhighlight %}

As a result, we obtain a _base version_ of `shlwapi.dll` (take a note of its revision number).

{% include orig-size-centered-fig.html filename="shlwapi_current_base.png" alt="?" %}

The next step is to apply a _forward differential_ (it is a part of the latest `microsoft-windows-shlwapi`).

{% highlight python linenos %}
>>> buf = apply_differential_to_file('shlwapi_current_base.dll',
...                                  lst[1].get_fwd_path('shlwapi.dll'))
>>> with open('shlwapi_current.dll', 'wb') as f:
...     f.write(buf)
...
276840
{% endhighlight %}

And there you have it: we generated the 2075th revision of `shlwapi.dll`.

{% include orig-size-centered-fig.html filename="shlwapi_current.png" alt="?" %}

In effect, there are not two but three versions of `shlwapi.dll` recoverable from _WinSxS_. It would be possible to reconstruct the base assembly if it were not for the hashing algorithm remaining undisclosed. Still, if needs must, we will do our best.

For the sake of demonstration, I created a fake `WinSxS` entry for the base assembly using `cafecafecafecafe` as a substitute for the unknown hash, and placed all three assemblies (the `wow64` variant) in a directory named `.\MiniWinSxS`. 

{% include code-block-header.html title="All available variants of wow64_microsoft-windows-shlwapi" %}
{% highlight none linenos %}
>python win_read_winsxs.py -f shlwapi.dll -p .\MiniWinSxS

microsoft-windows-shlwapi (arch = wow64, locale = none)
~~~~~~~~~~~~~~
microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: set()
         rev: set()
         null: set()
         arch: wow64
         ver: 10.0.19041.1
         ts: Thu Dec 29 08:54:18 2022
         loc: none
         token: 31bf3856ad364e35
         hash: cafecafecafecafe

microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: wow64
         ver: 10.0.19041.1706
         ts: Thu Dec 29 09:03:03 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 78b81e848e6ef719

microsoft-windows-shlwapi
         files: {'shlwapi.dll'}
         fwd: {'shlwapi.dll'}
         rev: {'shlwapi.dll'}
         null: set()
         arch: wow64
         ver: 10.0.19041.2075
         ts: Thu Dec 29 09:03:03 2022
         loc: none
         token: 31bf3856ad364e35
         hash: 790ae8ac8e2fc869


shlwapi.dll: 10.0.19041.1○ ==> 10.0.19041.1706 <==> 10.0.19041.2075
{% endhighlight %} 

Notice that the "update strand" grew by one entry. The 1706th revision of `shlwapi.dll` can be derived from the first revision of the same (which, a little circle next to it tells us, was recognized as base) by applying a forward differential only (hence the `==>` symbol instead of `<==>`).

## A Fun Experiment for The Curious

The idea of collecting earlier versions of system components from _WinSxS_ is all well and good, but the fact that nothing prevents Windows from removing assemblies that are no longer referenced challenges its viability as a strategy to recover updates history. How long will Windows keep old files for? While I cannot give you an explicit answer, identifying the longest sequence of files will, implicitly, provide a decent estimate. Below is a code snippet that would do just that.  

{% include code-block-header.html title="Identifying the longest sequence" %}
{% highlight python linenos %}
from win_read_winsxs import WinSxS, Sequence, Relation

ws = WinSxS()

mln = 0
mid = 0
for id, lst in ws.versioned_files.items():
    s = Sequence(lst, id.file)
    ln = 0
    for i in range(1, len(lst)):
        r = s.get_relation_to_parent(i)
        if (r == Relation.Forward) or (r == Relation.ReverseForward):
            ln += 1
            if ln > mln:
                mid = id
                mln = ln
        else:
            ln = 0
{% endhighlight %}

It must be an impressive piece of chronicling taking us from the very origin, wheels and sector gears, all the way up to the present day. A drum roll, please!

{% highlight python linenos %}
>>> print(Sequence(ws.versioned_files[mid], mid.file))

TpmTasks.dll: 10.0.19041.1880 <==> 10.0.19041.1889 <==> 10.0.19041.2311
{% endhighlight %}

Having counted a (recoverable) base version in for good measure, we conclude that the longest file sequence on the test computer is four assembly versions long. 

## Postscriptum

To those of my readers who are troubleshooting their system after an unfortunate update or, on the contrary, are looking into some vulnerability fixed by the recent security patch and have been lured here by the false promises of a clickbaity title: it is quite possible you do not need to touch _WinSxS_ at all. Try [Winbindex][winbindex] instead; the files you need may very well be there.

-- Ry Auscitte

## References

1. [Windows Updates using forward and reverse differentials][diff-whitepaper], Microsoft Docs
1. Jaime Geiger, [Extracting and Diffing Windows Patches in 2020][diff-patch]
1. [Everything you Never Wanted to Know about WinSxS][winsxs], A Blog About Stuff
1. Jon Wiswall, [What's that awful directory name under Windows\WinSxS?][winsxs-names], Nothing Ventured, Nothing Gained
1. Michael Maltsev, [Winbindex][winbindex]: The Windows Binaries Index
1. [wcpex][wcpex]: A tool to extract Windows Manifest files that can be found in the WinSxS folder 
1. {% include post-internal-reference.html post_id = "Dbxupdate-Parse" %}

[diff-whitepaper]:https://learn.microsoft.com/en-us/windows/deployment/update/psfxwhitepaper
[diff-patch]:https://wumb0.in/extracting-and-diffing-ms-patches-in-2020.html
[winsxs]:https://omnicognate.wordpress.com/2009/10/05/winsxs/
[winsxs-names]:https://learn.microsoft.com/en-us/archive/blogs/jonwis/whats-that-awful-directory-name-under-windowswinsxs
[wcpex]:https://github.com/smx-smx/wcpex
[winbindex]:https://winbindex.m417z.com/
