---
---

/** 
*   @file    custom_colorify_code.js 
*   @brief   "escape" syntax highlighter on top of rouge 
*
*   Lightweight syntax (in spirit of markdown) uses · and ¡ delimiters for emphasis and comments respectively.          
*   
*   @author   Ry Auscitte
*/


function custom_escape_colorify_code(){
    
    var cbs = document.getElementsByClassName("{{ site.highlighter_class_name }}");
    for (i = 0; i < cbs.length; i++) {
 
        cbs[i].innerHTML = cbs[i].innerHTML.replace(/·(.*?)·/g, function(m, g){
            return "<span class=\"nt\">" + g + "</span>";
        });
        
        cbs[i].innerHTML = cbs[i].innerHTML.replace(/¡(.*?)¡/g, function(m, g){
            return "<span class=\"c\">" + g + "</span>";
        });
    } 
}

document.addEventListener("DOMContentLoaded", custom_escape_colorify_code);
