
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
    
    var newWindow = window.open("", "_blank");
    
    //For whatever reason the code below has no effect. Even the title is not being set.
    //So I have no choice but to resort to nasty hacks.
    //newWindow.document.title = title;
    //var wrapper = newWindow.document.getElementById("wrapper");
    //wrapper.innerHTML = codefig.innerHTML;
    
    newWindow.document.write("<html><head><title>");
    newWindow.document.write(title);
    newWindow.document.write("</title><link rel=\"stylesheet\" href=\"/resources/css/main.css\"/></head><body>");
    newWindow.document.write("<figure class=\"highlight\" style=\"max-height:100%\">" + codefig.innerHTML + "</figure>");
    newWindow.document.write("</body></html>");
}

function copy_code_to_clipboard(el){

   var codeheader = el.parentElement.parentElement;
    
   var codefig = codeheader.nextSibling;
   if (codefig.className != "highlight") 
    	codefig = codefig.nextSibling;
   if (codefig.className != "highlight") 
    	return;

   
}
