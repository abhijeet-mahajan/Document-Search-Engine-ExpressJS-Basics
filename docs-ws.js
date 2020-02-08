'use strict';

const cors = require('cors');
const express = require('express');
const bodyParser = require('body-parser');
const process = require('process');
const url = require('url');
const queryString = require('querystring');

const OK = 200;
const CREATED = 201;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const SERVER_ERROR = 500;


//Main URLs
const DOCS = '/docs';
const COMPLETIONS = '/completions';

//Default value for count parameter
const COUNT = 5;

/** Listen on port for incoming requests.  Use docFinder instance
 *  of DocFinder to access document collection methods.
 */
function serve(port, docFinder) {
  const app = express();
  app.locals.port = port;
  app.locals.finder = docFinder;
  app.locals.base=DOCS;
  setupRoutes(app);
  const server = app.listen(port, async function() {
    console.log(`PID ${process.pid} listening on port ${port}`);
  });
  return server;
}

module.exports = { serve };

function setupRoutes(app) {
  const base = app.locals.base;
  app.use(cors());            //for security workaround in future projects
  app.use(bodyParser.json()); //all incoming bodies are JSON

  app.get(base, doList(app));
  app.get(`${base}/:name`, doGet(app));
  app.post(base, doCreate(app));
  app.get(COMPLETIONS, doCompletion(app));

  app.use(doErrors()); //must be last; setup for server errors   
}

function doCompletion(app) {
  return errorWrap(async function(req, res) {
    const q = req.query || {};
    try {
      if(q.text){
        const results = await app.locals.finder.complete(q.text);
        res.json(results);
      }else{
        throw{
          isDomain: true,
	        errorCode: 'BAD_PARAM',
	        message: `required query parameter \"text\" is missing`,
        }
      }
    }
    catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}

function doCreate(app) {
  return errorWrap(async function(req, res) {
    try {
      const obj = req.body;
      if(!obj.name){
        throw{
          isDomain: true,
	        errorCode: 'BAD_PARAM',
	        message: `required body parameter \"name\" is missing`,
        }
      }else if(!obj.content){
        throw{
          isDomain: true,
	        errorCode: 'BAD_PARAM',
	        message: `required body parameter \"content\" is missing`,
        }
        }else{
        const name=obj.name;
        const content=obj.content;
        const results = await app.locals.finder.addContent(name,content);
        const href=getRequestUrl(req) + '/' + name;
        res.status(201);
        res.append('Location',href );
        res.json({"href":href});
  
      }
    }
    catch(err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}




function doGet(app) {
  return errorWrap(async function(req, res) {
    try {
      const name = req.params.name;
      const results = await app.locals.finder.docContent(name);
      let links=[];
      links.push(new Link("self",getRequestUrl(req)));
      res.json({"content":results,"links":links});
    }
    catch(err) {
      if(err.code==='NOT_FOUND'){
        err.isDomain=true;
        err.errorCode='NOT_FOUND';
        err.message= `Document ${req.params.name} not found`;
      }
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}



function doList(app) {
  return errorWrap(async function(req, res) {
    const q = req.query || {};
    try {
      const count=q.count || 5;
      const start=q.start || 0;
      if(!(/^\d+$/.test(start)) || start<0){
        throw{
          isDomain: true,
	        errorCode: 'BAD_PARAM',
	        message: `"bad query parameter \"start\"`,
        }
      } else if(!(/^\d+$/.test(count)) || count<0){
        throw{
          isDomain: true,
	        errorCode: 'BAD_PARAM',
	        message: `"bad query parameter \"count\"`,
        }
      }else{
        const baseUrl=getRequestUrl(req).split("?").shift();
        const queryString=getRequestUrl(req).split("&").shift().split("?")[1];
  
        const results = await app.locals.finder.find(q.q);
        results.map(x=>x.href=baseUrl+"/"+x.name);
  
        let links=[];
        links.push(new Link("self",baseUrl+"?"+queryString+"&start="+start+"&count="+count));
        if(results.length>(start+count)){
          const next=start+count;
          links.push(new Link("next",baseUrl+"?"+queryString+"&start="+next+"&count="+count));
        }else{
          const prev=start-count;
          links.push(new Link("previous",baseUrl+"?"+queryString+"&start="+prev+"&count="+count));
        }
  
        res.json({"results":results.slice(start,start+count),"totalCount":results.length,"links":links});
      }
    }
    catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json(mapped);
    }
  });
}
const ERROR_MAP = {
  EXISTS: CONFLICT,
  NOT_FOUND: NOT_FOUND
}


function mapError(err) {
  return err.isDomain ? { 
      status: (ERROR_MAP[err.code] || BAD_REQUEST),
	    code: err.errorCode,
	    message: err.message
      }
    : { status: SERVER_ERROR,
	code: 'INTERNAL',
	message: err.toString()
      };
} 


//@TODO: add handler creation functions called by route setup
//routine for each individual web service.  Note that each
//returned handler should be wrapped using errorWrap() to
//ensure that any internal errors are handled reasonably.

/** Return error handler which ensures a server error results in nice
 *  JSON sent back to client with details logged on console.
 */ 
function doErrors(app) {
  return async function(err, req, res, next) {
    res.status(SERVER_ERROR);
    res.json({ code: 'SERVER_ERROR', message: err.message });
    console.error(err);
  };
}

/** Set up error handling for handler by wrapping it in a 
 *  try-catch with chaining to error handler on error.
 */
function errorWrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    }
    catch (err) {
      next(err);
    }
  };
}

function getRequestUrl(req) {
  const port = req.app.locals.port;
  return `${req.protocol}://${req.hostname}:${port}${req.originalUrl}`;
}
  

/** Return base URL of req for path.
 *  Useful for building links; Example call: baseUrl(req, DOCS)
 */
function baseUrl(req, path='/') {
  const port = req.app.locals.port;
  const url = `${req.protocol}://${req.hostname}:${port}${path}`;
  return url;
}

class Link{
  constructor(rel, href) {
    this.rel = rel; 
    this.href = href; 
  }

  getLink(){
    return {
      'rel':this.rel,
      'href':this.href
    }
  }
}

