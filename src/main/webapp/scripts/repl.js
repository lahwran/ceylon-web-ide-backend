var markers=[];
var bindings=[];

require.config({
    baseUrl: "scripts/modules",
    waitSeconds: 15
});

var jquery;
var editor;
var clprinted;
var spinCount = 0;
var live_tc={
  status:0,
  last:Date.now(),
  clear:function clear() {
    live_tc.status=1;
    live_tc.last=Date.now();
    live_tc.text=editor.getValue();
  }
};
var closePopups=undefined;

require(["ceylon/language/1.1.0/ceylon.language-1.1.0", 'jquery', 'jquery-ui-1.9.2'],
    function(clang, $, jqui) {
        jquery=$;
        $(document).ready(function() {
            console && console.log("Ceylon language module loaded OK");
            clang.getProcess().write = function(x){
                clprinted=true;
                printOutput(x.string);
            };
            clang.getProcess().writeLine = function(x){
                clprinted=true;
                printOutputLine(x.string);
            };
            console && console.log("ceylon.language.print() patched OK");
            $('form').submit(false);
            var donde=document.getElementById('edit_ceylon');
            editor = CodeMirror.fromTextArea(donde,{
                mode:'ceylon',
                gutters:["CodeMirror-error-gutter", "CodeMirror-gutter"],
                lineNumbers:true,
                indentUnit:4,
                matchBrackets:true,
                styleActiveLine:true,
                autoCloseBrackets:true,
                //highlightSelectionMatches:true,
                extraKeys:{
                    "Ctrl-D":function(cm){ fetchDoc(cm); },
                    "Cmd-D":function(cm){ fetchDoc(cm); },
                    "Ctrl-B":function(instance){ run(); },
                    "Cmd-B":function(instance){ run(); },
                    "Ctrl-.":function(){complete(editor);},
                    "Cmd-.":function(){complete(editor);}
                }
            });

    $(".CodeMirror").resizable({
      stop: function() { editor.refresh(); },
      resize: function() {
        $(".CodeMirror-scroll").height($(this).height());
        $(".CodeMirror-scroll").width($(this).width());
        $('#output').width($(this).width());
        $('#core-page').width($(this).width());
        editor.refresh();
      }
    });
    $('#output').resizable({
      stop: function() { editor.refresh(); },
      resize:function(){
        $(".CodeMirror-scroll").width($(this).width());
        editor.refresh();
      }
    });

            $('#shareurl').focus(function(){ jquery(this).select(); });
            $('#shareurl').hide();
            var key = location.href.split('#');
            if (key.length == 2 && key[1].toString().trim().length > 16) {
                //retrieve code
                key = key[1];
                $.ajax('share?key='+key, {
                    cache:false,
                    dataType:'text',
                    timeout:20000,
                    beforeSend:startSpinner,
                    complete:stopSpinner,
                    success:function(src,status,xhr) {
                        editor.setValue(src);
                    },
                    error:function(a,status,err) {
                        alert("Error retrieving shared code: " + (err?err:status));
                    }
                });
            } else if (location.href.indexOf('?src=') > 0) {
                //Code is directly in URL
                key = location.href.slice(location.href.indexOf('?src=')+5);
                editor.setValue(decodeURIComponent(key));
            } else if (location.href.indexOf('?sample=') > 0) {
                //Retrieve code from the given sample id
                key = location.href.slice(location.href.indexOf('?sample=')+8);
                editCode(key);
            } else {
            	runCode(wrapCode('print("Ceylon ``language.version`` \\"``language.versionName``\\"");'));
                editCode('hello_world');
            }
            editor.on('change',function(){live_tc.last=Date.now();});
            editor.on('cursorActivity',function(){
              if (closePopups)closePopups();
              closePopups=undefined;
            });
            window.setInterval(function(){
              if (live_tc.status==1 && editor.getValue()!=live_tc.text && Date.now()-live_tc.last>5000) {
                console.log("typechecking...");
                live_tc.text=editor.getValue();
                live_tc.last=Date.now();
    $.ajax('translate', {
        cache:false, type:'POST',
        dataType:'json',
        timeout:5000,
        success:function(json, status, xhr) {
            var errs = json['errors'];
            if (errs && errs.length>0) {
                showErrors(errs);
            } else {
                clearEditMarkers();
            }
        },
        error:function() {},
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        data:{tc:1,ceylon:wrapCode(live_tc.text)}
    });
              }
            },1000);
        });
    }
);

// autocompletion support
function complete(editor){
	var cursor = editor.getCursor();
    var code = getEditCode();
    live_tc.status=4;
    jQuery.ajax('assist', {
        cache:false, type:'POST',
        dataType:'json',
        timeout:20000,
        beforeSend: startSpinner,
        success: function(json, status, xhr){
        	stopSpinner();
        	CodeMirror.autocomplete(editor, function(){
        		return {
        			list: json.opts,
        			from: cursor,
        			to: cursor
        		};
        	});
        },
        error:function(xhr, status, err) {
        	stopSpinner();
            alert("An error occurred while compiling your code: " + err?err:status);
            live_tc.status=1;
        },
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        data: { 
        	ceylon:code,
        	r: cursor.line+2,
        	c: cursor.ch-1
        }
    });
}

//Stores the code on the server and displays a URL with the key to retrieve it
function shareSource() {
    function printUrl(key, status, xhr) {
        var url = (location.href.split(/\?|#/)[0]) + '#' + key;
        jquery('#shareurl').val(url);
        jquery('#shareurl').show();
        jquery('#shareurl').focus();
    }
    jquery.ajax('share', {
        cache:false, type:'POST',
        dataType:'text',
        timeout:20000,
        beforeSend:startSpinner,
        complete:stopSpinner,
        success:printUrl,
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        data:{ceylon:editor.getValue()}
    });
}

function startSpinner() {
    var button = $('#run_ceylon');
    button.attr('disabled','disabled');
    button.addClass('active');
    spinCount++;
}

function stopSpinner() {
    spinCount--;
    if (spinCount == 0) {
        var button = $('#run_ceylon');
        button.removeAttr('disabled');
        button.removeClass('active');
        editor.focus();
    }
}

var oldcode, transok;

//Shows the specified error messages in the code
function showErrors(errors, docs, refs) {
    printError("Code contains errors:");
    for (var i=0; i < errors.length;i++) {
        var err = errors[i];
        if (err.from.line > 1) {
            var errmsg = escapeHtml(err.msg);
            printError((err.from.line-1) + ":" + err.from.ch + " - " + err.msg);
            //This is to add a marker in the gutter
            var img = document.createElement('img');
            img.title=errmsg;
            img.src="images/error.gif";
            editor.setGutterMarker(err.from.line-2, 'CodeMirror-error-gutter', img);
            //This is to modify the style (underline or whatever)
            var marker=editor.markText({line:err.from.line-2,ch:err.from.ch},{line:err.to.line-2,ch:err.to.ch+1},{className:"cm-error"});
            markers.push(marker);
            //And this is for the hover
            var estilo="ceylonerr_r"+err.from.line+"_c"+err.from.ch;
            marker=editor.markText({line:err.from.line-2,ch:err.from.ch},{line:err.to.line-2,ch:err.to.ch+1},{className:estilo});
            markers.push(marker);
            bindings.push(estilo);
            jquery("."+estilo).attr("title", errmsg);
        }
    }
}

//Wraps the contents of the editor in a function and sends it to the server for compilation.
//On response, executes the script if compilation was OK, otherwise shows errors.
//In any case it sets the hover docs if available.
function translate(onTranslation) {
  var code = getEditCode();
  if (code != oldcode) {
      clearEditMarkers();
      translateCode(code, true, onTranslation);
  } else {
      if (onTranslation) {
          onTranslation();
      }
  }
}

//Wraps the contents of the editor in a function and sends it to the server for compilation.
//On response, executes the script if compilation was OK, otherwise shows errors.
//In any case it sets the hover docs if available.
function translateCode(code, doShowCode, onTranslation) {
    clearOutput();
    transok = false;
    var compileHandler = function(json, status, xhr) {
        oldcode = code;
        var translatedcode=json['code'];
        if (translatedcode) {
            showCode(translatedcode);
            try {
                globalEval(translatedcode);
                transok = true;
                if (onTranslation) {
                    onTranslation();
                }
            } catch(err) {
                printError("Translated code could not be parsed:");
                printError("--- " + err);
            }
        } else {
            //errors?
            var errs = json['errors'];
            if (errs) {
                showErrors(errs);
            }
        }
    };
    document.getElementById('run_ceylon').disabled=true;
    jquery.ajax('translate', {
        cache:false, type:'POST',
        dataType:'json',
        timeout:20000,
        beforeSend:startSpinner,
        complete:stopSpinner,
        success:compileHandler,
        error:function(xhr, status, err) {
            transok = false;
            alert("An error occurred while compiling your code: " + err?err:status);
        },
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        data:{ceylon:code}
    });
}

//Sends the code from the editor to the server for compilation and it successful, runs the resulting js.
function run() {
    translate(afterTranslate);
}

//Sends the given code to the server for compilation and it successful, runs the resulting js.
function runCode(code) {
  translateCode(code, false, afterTranslate);
}

//This function is called if compilation runs OK
function afterTranslate() {
    if (transok == true) {
        clprinted=false;
        //printSystem("// Script start at " + (new Date()));
        try {
            run_script();
        } catch(err) {
            printError("Runtime error:");
            printError("--- " + err);
        }
        if (!clprinted) {
            printSystem("Script ended with no output");
        }
        var _out = jquery("#output");
        _out.scrollTop(_out[0].scrollHeight);
    }
}

var stopfunc;

function setOnStop(func) {
	if (!stopfunc) {
		stopfunc = func;
		$('#run_ceylon').addClass('invis');
		$('#stop_ceylon').removeClass('invis');
	}
}

//A way to stop running scripts (that support it!)
function stop() {
	if (stopfunc) {
		try {
			stopfunc();
		} catch(e) {}
		stopfunc = undefined;
		$('#run_ceylon').removeClass('invis');
		$('#stop_ceylon').addClass('invis');
	}
}

//Retrieves the specified example from the editor, along with its hover docs.
function editCode(key) {
    //Make sure we don't do anything until we have an editor
    if (!editor) return false;
    //Retrieve code
    live_tc.status=2;
    jquery.ajax('hoverdoc?key='+key, {
        cache:true,
        dataType:'json',
        timeout:20000,
        beforeSend:startSpinner,
        complete:stopSpinner,
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        success:function(json, status, xhr) {
            clearEditMarkers();
            editor.setValue(json['src']);
            editor.focus();
            live_tc.clear();
        },
        error:function(xhr, status, err) {
            alert("error retrieving '" + key + "'example: " + err?err:status);
            live_tc.clear();
        }
    });
}

function getEditCode() {
    return wrapCode(editor.getValue());
}

function wrapCode(code) {
	if (!isFullScript(code)) {
		return "void run_script(){\n" + code + "\n}";
	} else {
		return code;
	}
}

function isFullScript(code) {
	var i;
	var hdr = extractHeaderComments(code);
	for (i = 0; i < hdr.length; ++i) {
		var line = hdr[i];
		if (line == "webrun_full_script") {
			return true;
		}
	}
	return false;
}

function extractHeaderComments(code) {
	var result = [];
	var i;
	var lines = code.split("\n");
	for (i = 0; i < lines.length; ++i) {
	    var line = lines[i].trimLeft();
	    if (line != "") {
	        if (line.indexOf("//$") == 0) {
	            // Not using trim() because it somehow doesn't work
		        line = line.substr(3).trimLeft().trimRight();
		        result.push(line);
	        } else {
                break;
	        }
	    }
	}
	return result;
}

function setEditCode(src) {
	if (src != getEditCode()) {
		clearOutput();
	    clearEditMarkers();
	    editor.setValue(src);
	    editor.focus();
	}
}

//Puts the specified text in the result element.
function showCode(code) {
    var result = document.getElementById("result");
    result.innerText = code;
    return false;
}

//Clears all error markers and hover docs.
function clearEditMarkers() {
    editor.clearGutter('CodeMirror-error-gutter');
    for (var i=0; i<markers.length;i++) {
        markers[i].clear();
    }
    markers=[];
    for (var i=0; i<bindings.length;i++) {
        jquery(bindings[i]).unbind('mouseenter mouseleave');
    }
    bindings=[];
}

function clearOutput() {
    var output = document.getElementById("output");
    output.innerHTML = "";
    editor.focus();
}

function printOutputLine(txt) {
    var output = document.getElementById("output");
    output.innerHTML = output.innerHTML + escapeHtml(txt) + "<br>";
}
function printOutput(txt) {
    var output = document.getElementById("output");
    output.innerHTML = output.innerHTML + escapeHtml(txt);
}

function printSystem(txt) {
    var output = document.getElementById("output");
    output.innerHTML = output.innerHTML + "<span class='jsc_msg'>" + escapeHtml(txt) + "</span><br>";
}

function printError(txt) {
    var output = document.getElementById("output");
    output.innerHTML = output.innerHTML + "<span class='jsc_error'>" + escapeHtml(txt) + "</span><br>";
}

//Basic HTML escaping.
function escapeHtml(html) {
    return (''+html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function globalEval(src) {
    if (window.execScript) {
        window.execScript(src);
        return;
    }
    var fn = function() {
        window.eval.call(window,src);
    };
    fn();
}

function fetchDoc(cm) {
    var code = getEditCode();
    var docHandler = function(json, status, xhr) {
        live_tc.status=1;
        if (json && json['name']) {
            if (json['doc']) {

                var pos = editor.cursorCoords(true);
                var help = document.createElement("div");
                help.className = "help infront";
                help.innerHTML = json['doc'];
                help.style.left = pos.left + "px";
                help.style.top = pos.bottom + "px";
                document.body.appendChild(help);
                var done = false;
                function close() {
                    if (done) return;
                    done = true;
                    jQuery("body").unbind('keydown', close);
                    jQuery("body").unbind('click', close);
                    help.parentNode.removeChild(help);
                }
                jQuery("body").keydown(close);
                jQuery("body").click(close);
                closePopups=close;
                help.focus();

            } else if (json['name'].startsWith("ceylon.language::")) {
                var tok = json['name'].substring(17);
                if (json['type'] === 'interface' || json['type'] === 'class') {
                    console.log("URL http://modules.ceylon-lang.org/test/ceylon/language/0.5/module-doc/"
                        + json['type'] + "_" + tok + ".html");
                } else {
                    console.log("URL http://modules.ceylon-lang.org/test/ceylon/language/0.5/module-doc/index.html#" + tok);
                }
            }
        }
    };
    document.getElementById('run_ceylon').disabled=true;
    var cursor = editor.getCursor();
    live_tc.status=3;
    jquery.ajax('hoverdoc', {
        cache:false, type:'POST',
        dataType:'json',
        timeout:20000,
        beforeSend:startSpinner,
        complete:stopSpinner,
        success:docHandler,
        error:function(xhr,status,err){
            transok=false;
            alert("An error occurred while retrieving documentation for your code: " + err?err:status);
            live_tc.status=1;
        },
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        data:{
            ceylon:code,
            r: cursor.line+2,
            c: cursor.ch-1
        }
    });
}
