var skateboard = require('skateboard');
var generate = require('generate-function');
var createClient = require('./client');
var qel = require('qel');
var detective = require('detective');

var threedee = require('./3d');
var setMesh = threedee.setMesh;
var addHelperMesh = threedee.addHelperMesh;
var clearHelperMeshes = threedee.clearHelperMeshes;
var createBrowserifyBundle = require('./browserify');

var EventEmitter = require("events").EventEmitter;

require('domready')(function() {

  var value = localStorage.getItem('text') || [
    'var distanceBetweenHoles = 31;',
    'var centerCircleDiameter = 22;',
    'var dimension = 42; // width and height',
    'var materialWidth = 3;',
    '',
    '// compute hole pattern',
    'var triLeg = distanceBetweenHoles/2;',
    'var l = Math.sqrt(triLeg*triLeg*2);',
    '',
    'var b = box(dimension, materialWidth, dimension);',
    'b = b.cut(cylinder(centerCircleDiameter/2, materialWidth));',
    '',
    'var TAU = Math.PI*2;',
    'var a45 = Math.PI/4;',
    'var a90 = Math.PI/2',
    '',
    'for (var i=1; i<=4; i++) {',
    '  var c = cylinder(1.5, materialWidth).translate(',
    '    l * Math.sin(i * a90 + a45),',
    '    0,',
    '    l * Math.cos(i * a90 + a45)',
    '  );',
    '',
    '  b = b.cut(c)',
    '}',
    '',
    'display(b)',
  ].join('\n');

  // setup editor
  var jse = require('javascript-editor')({
    container: qel('#editor'),
    value: value,
    updateInterval:  25
  });

  jse.marks = [];

  jse.editor.setCursor(0, 0);

  // fix "cursor is off the end of the line on last line" issue #29
  jse.editor.refresh();

  function clearErrors() {
    var els = qel('.code-error-message', null, true);
    var i = els.length;
    while (i--) {

      els[i].parentNode.removeChild(els[i]);
    }

    while (jse.errorLines.length) {
      var line = jse.errorLines.pop();
      jse.editor.removeLineClass(line.lineNumber, 'background', 'errorLine');
    }

    while (jse.marks.length) {
      jse.marks.pop().clear();
    }
  }


  skateboard(function(stream) {
    stream.socket.addEventListener('close', function() {
      setTimeout(function() {
        window.location.reload();
      }, 1000);
    });

    stream.once('data', function(uuid) {
      var ee = new EventEmitter();
      var localLineNumber = 0;
      var localColumnNumber = 0;

      var clientFunc = function(err, methods, wrapper, ee) {
        var header = Object.keys(methods).map(function(name) {
          return 'var ' + name + ' = ' + 'ops.' + name + ';';
        });

        // hijack display
        var _display = methods.display;
        methods.display = function() {
          typeof ga === 'function' && ga('send', 'event', 'net-oce', 'display', arguments.length);
          var p = _display.apply(null, arguments);
          p(function(e, r) {
            if (e) {
              // TODO: show an error
              console.error('nothing to display');
            } else {
              setMesh(e, r);
            }
          });
          return p;
        };

        methods.error = function (lineNumber, column, message) {
          jse.errorLines.push( {
            lineNumber: lineNumber,
            column: column,
            message: message
          } );
          jse.editor.addLineClass(lineNumber, 'background', 'errorLine');
          appendErrorLines();
        };

        function appendErrorLines() {
          if (jse.errorLines) {
            var els = qel('.errorLine', null, true);

            jse.errorLines.forEach(function(err, idx) {
              var el = document.createElement('error');
              el.setAttribute('class', 'code-error-message');
              var message = err.message.replace(/^Line \d*:/, '');
              el.innerHTML = message;

              document.body.appendChild(el);
              // find where the message should go
              var errorLineElement = els[idx];

              if (errorLineElement) {
                var topBounds = errorLineElement.getBoundingClientRect();
                el.style.top = topBounds.top + 'px';

                var leftBounds = jse.element.getBoundingClientRect();
                el.style.left = (leftBounds.right - 6) + 'px';

                var lineWrapper = getLineByNumber(err.lineNumber);
                var linePre = qel('pre span', lineWrapper);

                var span = document.createElement('span');
                span.setAttribute('class', 'errorLoc');

                var length = 1;
                if (message.toLowerCase().indexOf('unexpected token') > -1) {

                  message = message.replace(/unexpected token/i, '').trim();
                  if (message !== 'ILLEGAL') {
                    length = message.length;
                  }
                } else if (message.toLowerCase().indexOf(' is not defined') > -1) {
                  length = message.replace(/ is not defined/i, '').trim().length;
                }

                var mark = jse.editor.markText(
                  { line: err.lineNumber, ch: err.column - 1 },
                  { line: err.lineNumber, ch: err.column + length - 1 },
                  {
                    className : 'errorLoc'
                  }
                );

                jse.marks.push(mark);
              }
            });
          }
        }

        ee.on("setErrorMessage", function (errorMessage) {
          methods.error(localLineNumber, localColumnNumber, errorMessage);
        });

        ee.on('setErrorLocation', function (errorLocationInfo) {
          localLineNumber = errorLocationInfo.line;
          localColumnNumber = errorLocationInfo.column;
        });

        var evilMethodUsage;

        function evil (text, require) {
          try {
            var fn = generate()
              ('function(){')
                (header.join(';') + '\n')
                (text)
              ('}').toFunction({ops:methods, require:require});

            wrapper(fn, function(e, usage) {
              evilMethodUsage = usage;
            });

          } catch (e) {
            var matches = e.stack.match(/anonymous>:(\d*):(\d*)/);

            if (matches) {
              var lineNumber = parseInt(matches[1]) - 6;
              jse.errorLines.push( {
                lineNumber: lineNumber,
                message: e.message,
                column: parseInt(matches[2])
              });
              jse.editor.addLineClass(lineNumber, 'background', 'errorLine');
            }

            appendErrorLines();
          }
        }

        jse.editor._handlers.change[0]();

        var codeMirrorEl = qel('.CodeMirror');
        function getLineByNumber(num) {
          return qel('.CodeMirror-code div:nth-of-type(' + (num+1) + ')');
        }

        function getLine(span) {
          var line = span.parentNode.parentNode.parentNode;
          var where = 0;
          while(line.previousSibling) {
            line = line.previousSibling;
            where++;
          }
          return where;
        }

        function getColumn(span) {

          var c = 0;
          var pre = span.parentNode;
          var children = pre.childNodes;

          for (var i=0; i<children.length; i++) {
            var child = children[i];
            if (span === child) {
              break;
            }
            c += child.textContent.length;
          }

          return c;
        }

        codeMirrorEl.addEventListener('mousemove', function(e) {
          var el = e.target;

          var hovered = qel('.hovered', codeMirrorEl, true);
          var c = hovered.length;
          var alreadyHovered = el.className.indexOf('hovered') > -1;
          while(c--) {
            if (hovered[c] === el) {
              continue;
            }
            hovered[c].className = hovered[c].className.replace(/ *hovered */g, '');
          }

          if (alreadyHovered) {
            return;
          }

          clearHelperMeshes();

          if (el.className.indexOf('variable') > -1 || el.className.indexOf('property') > -1) {
            var name = el.textContent;

            if (methods[name]) {
              var line = getLine(el);
              var col = getColumn(el);
              if (evilMethodUsage && evilMethodUsage[line]) {

                var evilLine = evilMethodUsage[line];

                var someFunc = function(e, r) { // done to clear jshint warning
                  if (!future._displayFuture) {
                    typeof ga === 'function' && ga('send', 'event', 'shape', 'hover', arguments.length);
                    future._displayFuture = _display(r);
                  }

                  // TODO: Allow more than one mesh to be rendered.
                  future._displayFuture(addHelperMesh);
                };

                // match with the text
                for (var i=0; i<evilLine.length; i++) {

                  if (Math.abs(evilLine[i]._column - col) <= 2) {
                    var future = evilLine[i];

                    future(someFunc);
                  }
                }
              }

              el.className += ' hovered';
            }

          }

          // TODO: consider allowing hover of lines
          // TODO: consider hover of loops
        });

        jse.on('valid', function(valid, ast) {
          typeof ga === 'function' && ga('send', 'event', 'editor', 'change', valid ? 'valid' : 'invalid');

          if (valid) {
            clearErrors();

            var text = jse.getValue();
            localStorage.setItem('text', text);

            createBrowserifyBundle(text, window.location.href + 'bundle/' + uuid, function(errors, require) {
              if (errors) {

                // TODO: fix this hacky .reverse
                errors.reverse().map(function(e) {
                  if (e.start) {
                    var line = e.start.line - 1;
                    jse.marks.push(jse.editor.markText(
                      { line: line, ch: e.start.column + 9 },
                      { line: line, ch: e.end.column - 2 },
                      { className: 'errorLoc'}
                    ));

                    jse.errorLines.push( {
                      lineNumber: line,
                      message: "'" + e.module + "' not found",
                    });

                    jse.editor.addLineClass(line, 'background', 'errorLine');
                  }
                });
                appendErrorLines();
                return;
              }

              methods.reset(function() {
                evil(text, require);
              });
            });
          } else {
            appendErrorLines();
          }
        });

        window.methods = methods;
      };

      createClient(stream, clientFunc, ee);
    });
  });
});
