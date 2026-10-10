(function(){
  var b=document.getElementById('copy');
  if(b)b.addEventListener('click',function(){
    var done=function(){b.textContent='Copied!';setTimeout(function(){b.textContent='Copy link'},1800)};
    if(navigator.clipboard)navigator.clipboard.writeText(location.href).then(done,function(){window.prompt('Copy this link',location.href)});
    else window.prompt('Copy this link',location.href);
  });
  if(document.body.dataset.running)setTimeout(function(){location.reload()},4000);
})();
