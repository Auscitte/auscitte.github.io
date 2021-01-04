---
---

/** 
*   @file    code_wnd_btn_hndls.js 
*   @brief   onClick handlers for "maximize" and "copy all" buttons located in the headers of highlighted code blocks
*            
*   The implementation is tightly coupled with that of rouge highlighter and, as such, will, most likely, break
*   if the latter changes. Need a better solution.
*   
*   @author   Ry Auscitte
*/


function maximaize_code_window(el){
    
    var codeheader = el.parentElement.parentElement;
    
    var codefig = codeheader.nextSibling;
    if (codefig.className != "{{ site.highlighter_class_name }}") 
    	codefig = codefig.nextSibling;
    if (codefig.className != "{{ site.highlighter_class_name }}") 
    	return;
    	
    var title = "Source code";
    for (var i = 0; i < codeheader.childNodes.length; i++) {
       if (codeheader.childNodes[i].className == "code-header-title") {
          title = codeheader.childNodes[i].textContent;
          break;
       }        
    }	
    
    var newWindow = window.open("{{ site.baseurl }}/pages/code-window.html", "_blank");
    newWindow.onload = function () {
        newWindow.document.title = title;
        var wrapper = newWindow.document.getElementById("code_wrapper");
        wrapper.innerHTML = codefig.innerHTML;
    };
}

function find_element_by_tag_and_class(el, tag, cls) {
    for (var i = 0; i < el.childNodes.length; i++) {
       
        if (el.childNodes[i].nodeName.toLowerCase() == tag && el.childNodes[i].className == cls) 
            return el.childNodes[i];
       
        var pt = find_element_by_tag_and_class(el.childNodes[i], tag, cls);
        if (pt != null)
           return pt;
    }  
    return null;
}

function copy_code_to_clipboard(el){

   var codeheader = el.parentElement.parentElement;
    
   var codefig = codeheader.nextSibling;
   if (codefig.className != "{{ site.highlighter_class_name }}") 
    	codefig = codefig.nextSibling;
   if (codefig.className != "{{ site.highlighter_class_name }}") 
    	return;

   var pre = find_element_by_tag_and_class(codefig.firstElementChild, "pre", "");
   if (pre == null)
       return;
      
   navigator.clipboard.writeText(pre.textContent);    
}
