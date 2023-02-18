---
title: The Perils of Updating UEFI Secure Boot Revocation List
about: This series of articles is written in the form of the case study investigating a real-life problem, that of Ubuntu Live CD suddenly failing to boot on a computer where hitherto no such problem appeared. In the premise, we are presented with an error message yielding the clue that UEFI Secure Boot might be behind the boot malfunction, while a quick online search hints at the possibility of the latest Windows update being involved. Adopting a thorough approach, we begin with a sufficiently detailed description of Secure Boot operation and its objectives, then go on to explore Windows updates in general and the kind of updates that deal with Secure Boot settings in particular. Equipped with all the necessary information, we are now in a position to design the experiment demonstrating that it was, indeed, a Windows update that caused the issue, which, of course, will involve coding. $ Through a balanced presentation, including both, theory and practical demonstration, the series follows a problem-centric approach while requiring no additional research or prior knowledge of the subject to understand the material.
sequence:
    - Secure-Boot-Windows-Update
    - Linux-Shim-Bootloader
    - Dbxupdate-Parse
    - Exploring-WinSxS
layout: series
---


