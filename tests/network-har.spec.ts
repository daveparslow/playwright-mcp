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
import { test, expect } from './fixtures';

test('browser_save_network_har', async ({ client, server, startClient }) => {
  const outputDir = test.info().outputPath('output');
  const { client: clientWithOutput } = await startClient({
    config: {
      outputDir,
    }
  });

  server.route('/page.html', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head>
          <script src="/script.js"></script>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <h1>Test Page</h1>
        </body>
      </html>
    `);
  });

  server.route('/script.js', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('console.log("Hello from script");');
  });

  server.route('/style.css', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end('body { background: white; }');
  });

  // Navigate to the page to generate network requests
  await clientWithOutput.callTool({
    name: 'browser_navigate',
    arguments: {
      url: server.PREFIX + 'page.html',
    },
  });

  // Save network requests as HAR
  const harFilename = 'test-network.har';
  const saveHarResult = await clientWithOutput.callTool({
    name: 'browser_save_network_har',
    arguments: {
      filename: harFilename,
    },
  });

  expect(saveHarResult.content[0].text).toContain('Network requests saved to:');
  expect(saveHarResult.content[0].text).toContain(harFilename);

  // Verify the HAR file was created
  const harPath = path.join(outputDir, harFilename);
  expect(fs.existsSync(harPath)).toBe(true);

  // Parse and validate HAR file content
  const harContent = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
  expect(harContent).toHaveProperty('log');
  expect(harContent.log).toHaveProperty('version', '1.2');
  expect(harContent.log).toHaveProperty('creator');
  expect(harContent.log.creator).toHaveProperty('name', 'Playwright MCP');
  expect(harContent.log).toHaveProperty('pages');
  expect(harContent.log.pages).toHaveLength(1);
  expect(harContent.log).toHaveProperty('entries');
  expect(Array.isArray(harContent.log.entries)).toBe(true);
  expect(harContent.log.entries.length).toBeGreaterThan(0);

  // Verify that entries have the expected structure
  const entry = harContent.log.entries[0];
  expect(entry).toHaveProperty('request');
  expect(entry.request).toHaveProperty('method');
  expect(entry.request).toHaveProperty('url');
  expect(entry).toHaveProperty('response');
  expect(entry.response).toHaveProperty('status');
  expect(entry).toHaveProperty('timings');

  // Verify that we captured the main page and resources
  const urls = harContent.log.entries.map((e: any) => e.request.url);
  expect(urls.some((url: string) => url.includes('/page.html'))).toBe(true);

  await clientWithOutput.close();
});

test('browser_save_network_har with default filename', async ({ server, startClient }) => {
  const outputDir = test.info().outputPath('output-default');
  const { client } = await startClient({
    config: {
      outputDir,
    }
  });

  server.route('/simple.html', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Simple</h1></body></html>');
  });

  // Navigate to generate some requests
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: server.PREFIX + 'simple.html',
    },
  });

  // Save HAR without specifying filename
  const saveHarResult = await client.callTool({
    name: 'browser_save_network_har',
    arguments: {},
  });

  expect(saveHarResult.content[0].text).toContain('Network requests saved to:');
  expect(saveHarResult.content[0].text).toContain('network-');
  expect(saveHarResult.content[0].text).toContain('.har');

  // Verify at least one HAR file was created in the output directory
  const files = fs.readdirSync(outputDir);
  const harFiles = files.filter(f => f.startsWith('network-') && f.endsWith('.har'));
  expect(harFiles.length).toBeGreaterThan(0);

  await client.close();
});

test('browser_save_network_har tool is listed', async ({ client }) => {
  const tools = await client.listTools();
  const harTool = tools.tools.find(t => t.name === 'browser_save_network_har');
  
  expect(harTool).toBeDefined();
  expect(harTool?.description).toContain('HAR');
  expect(harTool?.description).toContain('network');
});
