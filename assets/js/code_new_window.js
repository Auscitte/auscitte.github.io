//The implementation is tightly coupled with that of rouge highlighter and will, most likely, break
//if the latter changes. Need a better solution.

function maximaize_code_window(el){
    
    var codeheader = el.parentElement.parentElement;
    
    var codefig = codeheader.nextSibling;
    if (codefig.className != "highlight") 
    	codefig = codefig.nextSibling;
    if (codefig.className != "highlight") 
    	return;
    	
    var title = "Source code";
    for (var i = 0; i < codeheader.childNodes.length; i++) {
       if (codeheader.childNodes[i].className == "code-header-title") {
          title = codeheader.childNodes[i].innerText;
          break;
       }        
    }	
    
    //For whatever reason the code below has no effect. Even the title is not being set.
    //So I have no choice but to resort to nasty hacks.
    //var newWindow = window.open("/pages/code-window.html", "_blank");
    //newWindow.document.title = title;
    //var wrapper = newWindow.document.getElementById("wrapper");
    //wrapper.innerHTML = codefig.innerHTML;
    
    var newWindow = window.open("", "_blank");
    newWindow.document.write("<html><head><title>");
    newWindow.document.write(title);
    newWindow.document.write("</title><link rel=\"stylesheet\" href=\"/resources/css/main.css\"/></head><body style=\"color:#A9B7C6\">");
    newWindow.document.write("<figure class=\"highlight\" style=\"max-height:100%\">" + codefig.innerHTML + "</figure>");
    newWindow.document.write("</body></html>");
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
   if (codefig.className != "highlight") 
    	codefig = codefig.nextSibling;
   if (codefig.className != "highlight") 
    	return;

   var pre = find_element_by_tag_and_class(codefig.firstElementChild, "pre", "");
   if (pre == null)
       return;
      
   navigator.clipboard.writeText(pre.innerText);    
}
