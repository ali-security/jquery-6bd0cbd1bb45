/*
 * CI helper (sealed build): runs the jQuery QUnit suite (test/index.html) in
 * headless Chrome via puppeteer and prints one line per test plus a summary,
 * because the upstream `npm test` (grunt) only builds and lints.
 * Usage: node test/ci/run-qunit.js <url-of-test/index.html>
 */
"use strict";

var puppeteer = require( "puppeteer-core" );
var url = process.argv[ 2 ];
var timeoutMs = 20 * 60 * 1000;

( async function() {
	var browser = await puppeteer.launch( {
		headless: "new",
		executablePath: process.env.CHROME_BIN,
		// Chrome deprecates the `unload` event by default; jQuery 1.11's data and
		// ajax suites bind it (#10080, #14379), so keep the 2014-era behaviour.
		args: [ "--no-sandbox", "--disable-dev-shm-usage",
			"--disable-features=DeprecateUnload,DeprecateUnloadByAllowList" ]
	} );
	console.log( "Browser: " + ( await browser.version() ) );
	var page = await browser.newPage();
	await page.setViewport( { width: 1280, height: 1024 } );
	var finished;
	var done = new Promise( function( resolve ) { finished = resolve; } );
	var failures = [];

	page.on( "console", function( m ) {
		if ( /Content.Security.Policy|violat/i.test( m.text() ) ) {
			console.log( "[console:" + m.type() + "] " + m.text() );
		}
	} );
	page.on( "pageerror", function( e ) {
		console.log( "[pageerror] " + e.message );
	} );

	await page.exposeFunction( "__qunitReport", function( type, data ) {
		if ( type === "testDone" ) {
			var status = data.failed ? "FAIL" : "PASS";
			console.log( "[" + status + "] " + data.module + " :: " + data.name +
				" (" + data.passed + "/" + data.total + " assertions)" );
			data.messages.forEach( function( m ) {
				console.log( "    " + m );
			} );
			if ( data.failed ) {
				failures.push( data.module + " :: " + data.name );
			}
		} else if ( type === "done" ) {
			finished( data );
		}
	} );

	// Hook QUnit's logging callbacks the moment qunit.js assigns window.QUnit
	// (top-level page only; iframes reuse parent.QUnit).
	await page.evaluateOnNewDocument( function() {
		if ( window.top !== window ) {
			return;
		}
		var q, messages = [], tests = 0, testsFailed = 0;
		Object.defineProperty( window, "QUnit", {
			configurable: true,
			enumerable: true,
			get: function() { return q; },
			set: function( v ) {
				q = v;
				v.log( function( d ) {
					if ( !d.result ) {
						var m = "assertion failed: " + ( d.message || "" );
						if ( "expected" in d ) {
							m += " | expected: " + String( d.expected ) + " | actual: " + String( d.actual );
						}
						messages.push( m );
					}
				} );
				v.testDone( function( d ) {
					tests++;
					if ( d.failed ) {
						testsFailed++;
					}
					window.__qunitReport( "testDone", {
						module: d.module, name: d.name, failed: d.failed,
						passed: d.passed, total: d.total, messages: messages
					} );
					messages = [];
				} );
				v.done( function( d ) {
					window.__qunitReport( "done", {
						tests: tests, testsFailed: testsFailed,
						assertions: d.total, assertionsPassed: d.passed,
						assertionsFailed: d.failed, runtime: d.runtime
					} );
				} );
			}
		} );
	} );

	var timer = setTimeout( function() {
		console.log( "QUnit run timed out after " + timeoutMs + "ms" );
		process.exit( 2 );
	}, timeoutMs );

	console.log( "Opening " + url );
	await page.goto( url, { waitUntil: "load", timeout: 120000 } );
	var r = await done;
	clearTimeout( timer );
	console.log( "" );
	console.log( "==== QUnit summary ====" );
	console.log( "Tests: " + r.tests + " total, " + ( r.tests - r.testsFailed ) +
		" passed, " + r.testsFailed + " failed" );
	console.log( "Assertions: " + r.assertions + " total, " + r.assertionsPassed +
		" passed, " + r.assertionsFailed + " failed (" + r.runtime + "ms)" );
	failures.forEach( function( f ) {
		console.log( "FAILED: " + f );
	} );
	await browser.close();
	process.exit( r.testsFailed ? 1 : 0 );
} )().catch( function( e ) {
	console.error( e );
	process.exit( 3 );
} );
