/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Request } from 'playwright';
import { defineTabTool } from './tool';
import type { Tab } from '../tab';
import type { Response } from '../response';

const requests = defineTabTool({
  capability: 'core' as const,
  schema: {
    name: 'browser_network_requests',
    title: 'List network requests',
    description: 'Returns all network requests since loading the page',
    inputSchema: z.object({}),
    type: 'readOnly' as const,
  },
  handle: async (tab: Tab, params: any, response: Response) => {
    const requestsList = await tab.requests();
    for (const request of requestsList)
      response.addResult(await renderRequest(request));
  },
});

async function renderRequest(request: Request): Promise<string> {
  const result: string[] = [];
  result.push(`[${request.method().toUpperCase()}] ${request.url()}`);
  const hasResponse = (request as any)._hasResponse;
  if (hasResponse) {
    const resp = await request.response();
    if (resp)
      result.push(`=> [${resp.status()}] ${resp.statusText()}`);
  }
  return result.join(' ');
}

const saveHar = defineTabTool({
  capability: 'core' as const,
  schema: {
    name: 'browser_save_network_har',
    title: 'Save network requests as HAR',
    description: 'Save all network requests since loading the page as a HAR (HTTP Archive) file',
    inputSchema: z.object({
      filename: z.string().optional().describe('File name to save the HAR to. Defaults to `network-{timestamp}.har` if not specified. Prefer relative file names to stay within the output directory.'),
    }),
    type: 'readOnly' as const,
  },
  handle: async (tab: Tab, params: { filename?: string }, response: Response) => {
    const requestsList = await tab.requests();
    const har = await buildHarFromRequests(requestsList, tab);
    const outputDir = tab.context.config.outputDir;
    let filename = params.filename;
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filename = `network-${timestamp}.har`;
    }
    const filePath = outputDir ? path.resolve(outputDir, filename) : path.resolve(filename);
    if (outputDir && !fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(har, null, 2));
    response.addResult(`Network requests saved to: ${filePath}`);
    response.addResult(`Total requests: ${requestsList.size}`);
  },
});

async function buildHarFromRequests(requests: Set<Request>, tab: Tab) {
  const entries: any[] = [];
  const page = tab.page;
  const startedDateTime = new Date().toISOString();
  
  for (const request of requests) {
    try {
      const entry = await buildHarEntry(request);
      if (entry)
        entries.push(entry);
    } catch (e) {
      // Silently skip requests that fail to serialize (e.g., canceled, blocked)
    }
  }
  
  return {
    log: {
      version: '1.2',
      creator: {
        name: 'Playwright MCP',
        version: '1.0',
      },
      pages: [
        {
          startedDateTime,
          id: 'page_1',
          title: await page.title().catch(() => ''),
          pageTimings: {},
        },
      ],
      entries,
    },
  };
}

async function buildHarEntry(request: Request) {
  const startedDateTime = new Date().toISOString();
  const url = request.url();
  const method = request.method();
  const requestHeaders: Array<{ name: string; value: string }> = [];
  
  try {
    const headers = await request.allHeaders();
    for (const [name, value] of Object.entries(headers)) {
      requestHeaders.push({ name, value });
    }
  } catch (e) {
    // Headers may not be available for some requests (e.g., failed/blocked)
  }
  
  const postData = request.postData();
  const requestEntry: any = {
    method,
    url,
    httpVersion: 'HTTP/1.1',
    headers: requestHeaders,
    queryString: [],
    cookies: [],
    headersSize: -1,
    bodySize: postData ? postData.length : 0,
  };
  
  if (postData) {
    requestEntry.postData = {
      mimeType: request.headers()['content-type'] || 'application/octet-stream',
      text: postData,
    };
  }
  
  const entry: any = {
    pageref: 'page_1',
    startedDateTime,
    time: 0,
    request: requestEntry,
    response: {
      status: 0,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      headers: [],
      cookies: [],
      content: {
        size: 0,
        mimeType: 'text/plain',
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: {
      send: 0,
      wait: 0,
      receive: 0,
    },
  };
  
  try {
    const response = await request.response();
    if (response) {
      const responseHeaders: Array<{ name: string; value: string }> = [];
      const headers = await response.allHeaders();
      for (const [name, value] of Object.entries(headers)) {
        responseHeaders.push({ name, value });
      }
      
      const status = response.status();
      const statusText = response.statusText();
      let bodySize = 0;
      let contentMimeType = 'text/plain';
      
      try {
        const body = await response.body();
        bodySize = body.length;
      } catch (e) {
        // Body may not be available for some responses (e.g., 204 No Content)
      }
      
      const contentTypeHeader = headers['content-type'];
      if (contentTypeHeader) {
        contentMimeType = contentTypeHeader.split(';')[0].trim();
      }
      
      entry.response = {
        status,
        statusText,
        httpVersion: 'HTTP/1.1',
        headers: responseHeaders,
        cookies: [],
        content: {
          size: bodySize,
          mimeType: contentMimeType,
        },
        redirectURL: '',
        headersSize: -1,
        bodySize,
      };
      
      const timing = request.timing();
      if (timing) {
        entry.time = timing.responseEnd;
        const sslTime = timing.secureConnectionStart >= 0
          ? Math.max(0, timing.connectEnd - timing.secureConnectionStart)
          : -1;
        entry.timings = {
          dns: Math.max(0, timing.domainLookupEnd - timing.domainLookupStart),
          connect: Math.max(0, timing.connectEnd - timing.connectStart),
          ssl: sslTime,
          send: Math.max(0, timing.requestStart - timing.connectEnd),
          wait: Math.max(0, timing.responseStart - timing.requestStart),
          receive: Math.max(0, timing.responseEnd - timing.responseStart),
        };
      }
    }
  } catch (e) {
    // Response may not be available for some requests (e.g., canceled, blocked)
  }
  
  return entry;
}

export default [requests, saveHar];
