document.addEventListener('DOMContentLoaded', async () => {
    const statusDiv = document.getElementById('status');
    const statusText = document.getElementById('status-text');
    const contentDiv = document.getElementById('content');
    const summaryDiv = document.getElementById('summary');
    const loadingDiv = document.getElementById('loading');
    const summarizeBtn = document.getElementById('summarize-btn');
    const optionsBtn = document.getElementById('options-btn');

    let currentPageData = null;

    // Get current tab and check for T&C content
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check if the current page can be analyzed
    if (!canAnalyzePage(tab.url)) {
        statusDiv.className = 'status not-found';
        statusText.textContent = 'Cannot analyze this type of page (system or extension pages)';
        summarizeBtn.disabled = true;
        return;
    }

    try {
        // Inject content script and get page data
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: detectAndExtractTC
        });

        currentPageData = results[0].result;

        if (currentPageData && currentPageData.isTC) {
            statusDiv.className = 'status found';
            statusText.textContent = `Found T&C page: ${currentPageData.confidence}% confidence`;
            summarizeBtn.disabled = false;

            // Check if we have a cached summary
            const cacheKey = `summary_${btoa(tab.url).slice(0, 50)}`;
            const cached = await chrome.storage.local.get([cacheKey]);
            if (cached[cacheKey]) {
                displayAnalysis(cached[cacheKey]);
            }
        } else {
            statusDiv.className = 'status not-found';
            statusText.textContent = 'No Terms & Conditions content detected on this page';
            summarizeBtn.disabled = true;
        }
    } catch (error) {
        console.error('Error detecting T&C:', error);
        statusDiv.className = 'status error';
        statusText.textContent = 'Error occurred while analyzing page content. Please try again.';
        summarizeBtn.disabled = true;
    }

    // Summarize button click
    summarizeBtn.addEventListener('click', async () => {
        if (!currentPageData || !currentPageData.isTC) return;

        try {
            showLoading(true);

            const analysis = await generateAnalysis(currentPageData.text);

            // Cache the analysis
            const cacheKey = `summary_${btoa(tab.url).slice(0, 50)}`;
            await chrome.storage.local.set({ [cacheKey]: analysis });

            displayAnalysis(analysis);
        } catch (error) {
            console.error('Analysis error:', error);
            statusDiv.className = 'status error';
            statusText.textContent = 'Failed to generate analysis. Please check if the backend server is running.';
            showLoading(false);
        }
    });

    // Options button click
    optionsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    function showLoading(show) {
        if (show) {
            statusDiv.style.display = 'none';
            loadingDiv.style.display = 'block';
        } else {
            statusDiv.style.display = 'block';
            loadingDiv.style.display = 'none';
        }
        summarizeBtn.disabled = show;
    }

    function displayAnalysis(analysis) {
        let html = '';

        // Display risk level indicator
        if (analysis.metadata && analysis.metadata.risk_level) {
            const riskLevel = analysis.metadata.risk_level;
            const riskColors = {
                'low': '#006400',
                'medium': '#FF8C00',
                'high': '#8B0000'
            };
            const riskEmojis = {
                'low': '✅',
                'medium': '⚠️',
                'high': '🚨'
            };

            html += `
                <div style="padding: 12px; margin-bottom: 16px; border-radius: 8px; background-color: ${riskColors[riskLevel] || '#6c757d'}15; border: 1px solid ${riskColors[riskLevel] || '#6c757d'}40;">
                    <div style="font-weight: bold; color: ${riskColors[riskLevel] || '#6c757d'}; margin-bottom: 8px;">
                        ${riskEmojis[riskLevel] || '📄'} Risk Level: ${riskLevel.toUpperCase()}
                    </div>
                    <div style="font-size: 12px; color: #000000;">
                        ${analysis.metadata.total_concerns || 0} concerns found • ${analysis.metadata.categories_found || 0} categories • ${analysis.metadata.word_count || 0} words
                    </div>
                </div>
            `;
        }

        // Display summary if available
        if (analysis.summary) {
            html += `
                <div style="margin-bottom: 20px;">
                    <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: bold; color: #333;">📄 Summary</h3>
                    <div style="padding: 12px; background-color: #f8f9fa; border-radius: 6px; font-size: 13px; line-height: 1.4; color: #333;">
                        ${analysis.summary}
                    </div>
                </div>
            `;
        }

        // Display categories - Enhanced to show even if empty
        if (analysis.categories && Object.keys(analysis.categories).length > 0) {
            html += '<h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: bold; color: #333;">🔍 Key Findings</h3>';
            
            for (const [categoryKey, categoryData] of Object.entries(analysis.categories)) {
                html += `
                    <div style="margin-bottom: 16px; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                        <div style="background-color: #f5f5f5; padding: 10px; font-weight: bold; font-size: 13px; color: #333; border-bottom: 1px solid #e0e0e0;">
                            ${categoryData.display_name} (${categoryData.count})
                        </div>
                        <div style="padding: 12px;">
                `;
                
                categoryData.items.forEach((item, index) => {
                    html += `
                        <div style="margin-bottom: ${index < categoryData.items.length - 1 ? '8px' : '0'}; padding: 8px; background-color: #fafafa; border-radius: 4px; font-size: 12px; line-height: 1.3; color: #555;">
                            ${escapeHtml(item)}
                        </div>
                    `;
                });
                
                html += `
                        </div>
                    </div>
                `;
            }
        } else {
            // This should now be much less common with the improved backend
            html += `
                <div style="padding: 20px; text-align: center; color: #666; font-size: 13px;">
                    🔍 No specific policy concerns detected in this document.<br>
                    <small style="color: #999; font-size: 11px;">This might be a short document or the content wasn't recognized as T&C.</small>
                </div>
            `;
        }

        summaryDiv.innerHTML = html;
        contentDiv.style.display = 'block';
        showLoading(false);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Helper function to check if a page can be analyzed
    function canAnalyzePage(url) {
        const restrictedProtocols = [
            'chrome://',
            'chrome-extension://',
            'moz-extension://',
            'edge://',
            'about:',
            'file://'
        ];

        const restrictedDomains = [
            'chrome.google.com/webstore',
            'addons.mozilla.org',
            'microsoftedge.microsoft.com'
        ];

        // Check protocols
        for (const protocol of restrictedProtocols) {
            if (url.startsWith(protocol)) {
                return false;
            }
        }

        // Check restricted domains
        for (const domain of restrictedDomains) {
            if (url.includes(domain)) {
                return false;
            }
        }

        return true;
    }
});

// Function to be injected into the page - Enhanced for better detection
function detectAndExtractTC() {
    // More comprehensive T&C indicators
    const tcIndicators = [
        'terms of service', 'terms of use', 'terms and conditions',
        'user agreement', 'privacy policy', 'legal', 'eula',
        'end user license agreement', 'service agreement',
        'acceptable use policy', 'community guidelines',
        'data policy', 'cookie policy', 'disclaimer'
    ];

    // Check URL with better matching
    const url = window.location.href.toLowerCase();
    let urlScore = 0;
    tcIndicators.forEach(indicator => {
        const variations = [
            indicator.replace(/\s+/g, '-'),
            indicator.replace(/\s+/g, ''),
            indicator.replace(/\s+/g, '_')
        ];
        
        variations.forEach(variation => {
            if (url.includes(variation)) {
                urlScore += 20;
            }
        });
    });

    // Check page title
    const title = document.title.toLowerCase();
    let titleScore = 0;
    tcIndicators.forEach(indicator => {
        if (title.includes(indicator)) {
            titleScore += 25;
        }
    });

    // Check headings with better extraction
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        .map(h => h.textContent.toLowerCase()).join(' ');
    let headingScore = 0;
    tcIndicators.forEach(indicator => {
        if (headings.includes(indicator)) {
            headingScore += 15;
        }
    });

    // Enhanced content extraction
    let mainContent = '';

    // Try to find main content containers with better selectors
    const contentSelectors = [
        'main', '[role="main"]', '.content', '.main-content',
        '.terms', '.legal-content', '.policy-content', '.terms-content',
        'article', '.article-content', '.document-content',
        '.policy', '.agreement', '.legal'
    ];

    let contentElement = null;
    for (const selector of contentSelectors) {
        contentElement = document.querySelector(selector);
        if (contentElement && contentElement.innerText.trim().length > 500) {
            break;
        }
    }

    if (!contentElement) {
        contentElement = document.body;
    }

    // Extract text content with better cleaning
    const rawText = contentElement.innerText || contentElement.textContent || '';
    mainContent = rawText.replace(/\s+/g, ' ').trim();

    // Enhanced content analysis
    let contentScore = 0;
    const contentLower = mainContent.toLowerCase();

    // More comprehensive legal language patterns
    const legalPatterns = [
        'hereby agree', 'terms of service', 'user agreement',
        'privacy policy', 'data collection', 'intellectual property',
        'limitation of liability', 'governing law', 'dispute resolution',
        'termination', 'prohibited uses', 'account suspension',
        'we collect', 'personal information', 'third party',
        'cookies', 'tracking', 'analytics', 'marketing',
        'license', 'copyright', 'trademark', 'warranty',
        'indemnify', 'binding arbitration', 'class action'
    ];

    legalPatterns.forEach(pattern => {
        const regex = new RegExp(pattern, 'gi');
        const matches = mainContent.match(regex);
        if (matches) {
            contentScore += matches.length * 3; // Reduced weight per match
        }
    });

    // Bonus for document structure indicators
    const structurePatterns = [
        /\d+\.\s+[A-Z]/g, // Numbered sections
        /section\s+\d+/gi,
        /article\s+\d+/gi,
        /clause\s+\d+/gi
    ];

    structurePatterns.forEach(pattern => {
        const matches = mainContent.match(pattern);
        if (matches) {
            contentScore += matches.length * 2;
        }
    });

    // Calculate total confidence with better weighting
    const totalScore = Math.min(100, urlScore + titleScore + headingScore + Math.min(contentScore, 50));
    const isTC = totalScore >= 25; // Slightly lower threshold

    console.log(`T&C Detection: URL=${urlScore}, Title=${titleScore}, Heading=${headingScore}, Content=${contentScore}, Total=${totalScore}`);

    return {
        isTC: isTC,
        confidence: Math.round(totalScore),
        text: mainContent.substring(0, 10000), // Increased limit
        url: window.location.href,
        title: document.title
    };
}

async function generateAnalysis(text) {
    try {
        const response = await fetch('https://clearterms-backend.onrender.com/summarize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.error);
        }

        return {
            summary: result.summary,
            categories: result.categories || {},
            metadata: result.metadata || {}
        };
    } catch (error) {
        console.error('Error generating analysis:', error);
        
        // Enhanced fallback: try categories-only endpoint
        try {
            const fallbackResponse = await fetch('https://clearterms-backend.onrender.com/categories-only', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });

            if (fallbackResponse.ok) {
                const fallbackResult = await fallbackResponse.json();
                return {
                    summary: 'Summary unavailable, but detailed analysis provided below.',
                    categories: fallbackResult.categories || {},
                    metadata: fallbackResult.metadata || {}
                };
            }
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
        }
        
        throw error; // Re-throw original error
    }
}