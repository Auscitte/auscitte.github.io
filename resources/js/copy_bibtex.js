---
---

/** 
*   @file    code_bibtex.js 
*   @brief   Generates a BibTex entry for the current post based on its title, year, and url
*    
*   @author   Ry Auscitte
*/

function copy_bibtex_ref_to_clipboard(title, url, year) {
    var author = "{{ site.owner }}";
    var names = author.split(" ");
    var last = names[names.length - 1] + ",";
    names.pop();
    names.splice(0, 0, last);
    author = names.join(" ");
    
    urlps = url.split("/");
    
    var dt = new Date();
    dt = new Date(dt.getTime() - (dt.getTimezoneOffset() * 60 * 1000));
    adate = dt.toISOString().split("T")[0];
    
    var rf = "@misc{" + urlps[urlps.length - 1] + ",\n";
    rf += "    author = {" + author + "},\n";
    rf += "    title = {" + title + "},\n";
    rf += "    howpublished = \"\\url{" + url + "}\",\n";
    rf += "    year = {" + year + "},\n";
    rf += "    note = \"[Online; accessed " + adate + "]\"\n";
    rf += "}";
    
    navigator.clipboard.writeText(rf);
}
