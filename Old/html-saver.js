const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Wait for a specified amount of time
 * @param {number} ms - Milliseconds to wait
 */
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Save full HTML of a website after JavaScript renders
 * @param {string} url - The URL to scrape
 * @param {string} outputFile - Output filename (optional, defaults to domain.html)
 * @param {number} waitTime - Time to wait for JS to render in ms (default: 3000)
 */
const saveFullHTML = async (url, outputFile = null, waitTime = 3000) => {
  console.log(`Starting to scrape: ${url}`);
  
  const browser = await puppeteer.launch({ 
    headless: true, // Set to false if you want to see the browser
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to the page
    console.log('Loading page...');
    await page.goto(url, { 
      waitUntil: 'networkidle2', // Wait until network is idle
      timeout: 30000 
    });
    
    // Wait additional time for JavaScript to render
    console.log(`Waiting ${waitTime}ms for JavaScript to render...`);
    await wait(waitTime);
    
    // Get the full HTML after JavaScript has rendered
    console.log('Extracting HTML...');
    const html = await page.content();
    
    // Generate filename if not provided
    if (!outputFile) {
      const domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      outputFile = `${domain}_${timestamp}.html`;
    }
    
    // Ensure .html extension
    if (!outputFile.endsWith('.html')) {
      outputFile += '.html';
    }
    
    // Save to file
    fs.writeFileSync(outputFile, html, 'utf8');
    console.log(`HTML saved to: ${outputFile}`);
    console.log(`File size: ${(html.length / 1024).toFixed(2)} KB`);
    
    return {
      success: true,
      filename: outputFile,
      size: html.length,
      url: url
    };
    
  } catch (error) {
    console.error('Error scraping the page:', error.message);
    return {
      success: false,
      error: error.message,
      url: url
    };
  } finally {
    await browser.close();
  }
};

/**
 * Save HTML with custom options
 * @param {string} url - The URL to scrape
 * @param {Object} options - Options object
 */
const saveHTMLWithOptions = async (url, options = {}) => {
  const {
    outputFile = null,
    waitTime = 3000,
    headless = true,
    viewport = { width: 1920, height: 1080 },
    userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    waitForSelector = null, // Wait for specific element before saving
    screenshot = false, // Also take a screenshot
    screenshotFile = null
  } = options;
  
  console.log(`Starting to scrape: ${url}`);
  
  const browser = await puppeteer.launch({ 
    headless: headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport(viewport);
    
    // Set user agent
    await page.setUserAgent(userAgent);
    
    // Navigate to the page
    console.log('Loading page...');
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for specific selector if provided
    if (waitForSelector) {
      console.log(`Waiting for selector: ${waitForSelector}`);
      await page.waitForSelector(waitForSelector, { timeout: 10000 });
    }
    
    // Wait additional time for JavaScript to render
    console.log(`Waiting ${waitTime}ms for JavaScript to render...`);
    await wait(waitTime);
    
    // Take screenshot if requested
    if (screenshot) {
      const screenshotFilename = screenshotFile || outputFile?.replace('.html', '.png') || 'screenshot.png';
      await page.screenshot({ 
        path: screenshotFilename, 
        fullPage: true 
      });
      console.log(`Screenshot saved to: ${screenshotFilename}`);
    }
    
    // Get the full HTML after JavaScript has rendered
    console.log('Extracting HTML...');
    const html = await page.content();
    
    // Generate filename if not provided
    let finalOutputFile = outputFile;
    if (!finalOutputFile) {
      const domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      finalOutputFile = `${domain}_${timestamp}.html`;
    }
    
    // Ensure .html extension
    if (!finalOutputFile.endsWith('.html')) {
      finalOutputFile += '.html';
    }
    
    // Save to file
    fs.writeFileSync(finalOutputFile, html, 'utf8');
    console.log(`HTML saved to: ${finalOutputFile}`);
    console.log(`File size: ${(html.length / 1024).toFixed(2)} KB`);
    
    return {
      success: true,
      filename: finalOutputFile,
      size: html.length,
      url: url,
      screenshot: screenshot ? (screenshotFile || finalOutputFile.replace('.html', '.png')) : null
    };
    
  } catch (error) {
    console.error('Error scraping the page:', error.message);
    return {
      success: false,
      error: error.message,
      url: url
    };
  } finally {
    await browser.close();
  }
};

// Export functions
module.exports = {
  saveFullHTML,
  saveHTMLWithOptions
};

// Run if called directly
if (require.main === module) {
  const url = process.argv[2];
  const outputFile = process.argv[3];
  const waitTime = parseInt(process.argv[4]) || 3000;
  
  if (!url) {
    console.log('Usage: node html-saver.js <URL> [output-file] [wait-time-ms]');
    console.log('Examples:');
    console.log('  node html-saver.js https://example.com');
    console.log('  node html-saver.js https://example.com my-page.html');
    console.log('  node html-saver.js https://example.com my-page.html 5000');
    process.exit(1);
  }
  
  saveFullHTML(url, outputFile, waitTime).then(result => {
    if (result.success) {
      console.log('✅ Success!');
    } else {
      console.log('❌ Failed!');
      process.exit(1);
    }
  });
}
