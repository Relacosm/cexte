from flask import Flask, request, jsonify
from flask_cors import CORS
import re
import requests
import os
import time
from typing import Dict, List, Optional

app = Flask(__name__)
CORS(app)

# Hugging Face API Configuration
HF_API_BASE = "https://api-inference.huggingface.co/models"
HF_MODELS = {
    'primary': 'facebook/bart-large-cnn',
    'fallback': 'sshleifer/distilbart-cnn-12-6',  # Smaller, faster model
    'lightweight': 't5-small'  # Most lightweight option
}

class HuggingFaceAPIClient:
    def __init__(self):
        self.api_key = os.getenv('HUGGINGFACE_API_KEY')
        self.headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        self.max_retries = 2
        self.timeout = 30
    
    def summarize_text(self, text: str, max_length: int = 150, min_length: int = 40) -> Optional[str]:
        """Generate summary using Hugging Face API with fallback models"""
        
        # Prepare text for summarization (clean and truncate if needed)
        clean_text = self._prepare_text_for_api(text)
        
        # Try models in order of preference
        for model_key, model_name in HF_MODELS.items():
            try:
                summary = self._call_api(model_name, clean_text, max_length, min_length)
                if summary:
                    print(f"✅ Summary generated using {model_name}")
                    return summary
                    
            except Exception as e:
                print(f"❌ Model {model_name} failed: {e}")
                continue
        
        # If all APIs fail, return None (fallback to rule-based)
        print("🔄 All HF models failed, will use rule-based summary")
        return None
    
    def _prepare_text_for_api(self, text: str) -> str:
        """Prepare text for API consumption"""
        # Clean the text
        text = re.sub(r'\s+', ' ', text.strip())
        
        # For summarization APIs, we want to send relevant portions
        # Prioritize sections that contain policy information
        important_keywords = [
            'privacy', 'data', 'information', 'collect', 'share', 'terms',
            'agreement', 'policy', 'rights', 'liability', 'account',
            'subscription', 'payment', 'cancel', 'terminate'
        ]
        
        sentences = re.split(r'[.!?]+', text)
        scored_sentences = []
        
        for sentence in sentences:
            if len(sentence.strip()) < 20:
                continue
                
            score = sum(1 for keyword in important_keywords 
                       if keyword.lower() in sentence.lower())
            scored_sentences.append((sentence.strip(), score))
        
        # Sort by relevance and take top sentences
        scored_sentences.sort(key=lambda x: x[1], reverse=True)
        
        # Build text up to API limits (most APIs handle ~1024 tokens well)
        selected_text = ""
        for sentence, score in scored_sentences:
            if len(selected_text) + len(sentence) > 3000:  # Conservative limit
                break
            selected_text += sentence + ". "
        
        return selected_text.strip() or text[:3000]  # Fallback to truncated original
    
    def _call_api(self, model_name: str, text: str, max_length: int, min_length: int) -> Optional[str]:
        """Make API call to specific model"""
        url = f"{HF_API_BASE}/{model_name}"
        
        payload = {
            "inputs": text,
            "parameters": {
                "max_length": max_length,
                "min_length": min_length,
                "do_sample": False,
                "early_stopping": True
            }
        }
        
        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    url, 
                    headers=self.headers, 
                    json=payload, 
                    timeout=self.timeout
                )
                
                if response.status_code == 200:
                    result = response.json()
                    
                    # Handle different response formats
                    if isinstance(result, list) and len(result) > 0:
                        return result[0].get('summary_text', '').strip()
                    elif isinstance(result, dict):
                        return result.get('summary_text', '').strip()
                        
                elif response.status_code == 503:
                    # Model loading, wait and retry
                    print(f"🔄 Model {model_name} loading, waiting...")
                    time.sleep(5)
                    continue
                    
                else:
                    print(f"❌ API error {response.status_code}: {response.text}")
                    break
                    
            except requests.exceptions.Timeout:
                print(f"⏰ Timeout for {model_name}, attempt {attempt + 1}")
                continue
            except Exception as e:
                print(f"❌ Request failed for {model_name}: {e}")
                break
        
        return None

class CategorizedTCAnalyzer:
    def __init__(self):
        # Your comprehensive categories with enhanced patterns
        self.categories = {
            'permissions_asked': {
                'patterns': [
                    r'we (?:may )?(?:collect|access|gather|obtain|use|process|store)',
                    r'information (?:we|may) (?:collect|gather|access)',
                    r'(?:location|contact|camera|microphone|photo|device) (?:data|information|access)',
                    r'permission to (?:access|use|collect)',
                    r'we (?:may )?(?:track|monitor|record)',
                    r'browsing (?:history|data|information)',
                    r'personal (?:data|information) (?:includes?|such as)',
                    r'automatically collect',
                    r'usage (?:data|information|statistics)',
                    r'cookies and (?:similar )?technologies',
                    r'device identifiers?',
                    r'ip address'
                ],
                'keywords': [
                    'collect personal data', 'access your', 'gather information',
                    'location data', 'contact information', 'device information',
                    'browsing history', 'usage data', 'automatically collect',
                    'cookies', 'tracking pixels', 'analytics data', 'log files',
                    'device identifiers', 'ip address', 'user behavior'
                ],
                'display_name': '🔐 Data Collection & Permissions'
            },
            'privacy_concerns': {
                'patterns': [
                    r'(?:share|sell|disclose|provide) (?:your )?(?:personal )?(?:data|information)',
                    r'third[- ]party (?:partners|services|companies)',
                    r'(?:marketing|advertising|promotional) purposes',
                    r'targeted (?:ads|advertising|marketing)',
                    r'behavioral (?:tracking|targeting|advertising)',
                    r'profile (?:you|your (?:interests|preferences))',
                    r'(?:sell|transfer|share) (?:to|with) (?:third parties|partners|advertisers)',
                    r'data (?:sharing|transfer) agreements?',
                    r'business (?:partners|affiliates)'
                ],
                'keywords': [
                    'share with third parties', 'sell your information', 'marketing purposes',
                    'advertising partners', 'data sharing', 'third party services',
                    'targeted advertising', 'behavioral tracking', 'profiling',
                    'partners and affiliates', 'service providers', 'data brokers',
                    'cross-border transfer', 'international transfer'
                ],
                'display_name': '🔒 Data Sharing & Privacy'
            },
            'payment_terms': {
                'patterns': [
                    r'(?:subscription|payment|billing|fee|charge)s? (?:will|are|may)',
                    r'(?:auto|automatic)(?:matic)?(?:ally)? (?:renew|charge|bill)',
                    r'(?:non[- ]?refundable|no refund)',
                    r'free trial (?:will|ends|expires)',
                    r'cancel(?:lation)? (?:policy|terms|fee)',
                    r'payment (?:method|information) (?:will|may)',
                    r'recurring (?:payment|billing|subscription)',
                    r'prorated (?:charges?|billing)',
                    r'early termination fee'
                ],
                'keywords': [
                    'subscription fee', 'automatic renewal', 'auto-renew', 'billing cycle',
                    'non-refundable', 'no refunds', 'cancellation policy', 'free trial',
                    'recurring payment', 'payment method', 'billing information',
                    'prorated charges', 'early termination', 'upgrade fees'
                ],
                'display_name': '💳 Payment & Subscription Terms'
            },
            'account_control': {
                'patterns': [
                    r'(?:terminate|suspend|disable|deactivate|ban) (?:your )?account',
                    r'(?:at our|in our) (?:sole )?discretion',
                    r'without (?:prior )?notice',
                    r'(?:violate|breach) (?:these )?terms',
                    r'restrict (?:your )?access',
                    r'we (?:may|reserve the right to) (?:suspend|terminate|disable)',
                    r'immediate (?:termination|suspension)',
                    r'for any reason'
                ],
                'keywords': [
                    'terminate your account', 'suspend service', 'ban users',
                    'sole discretion', 'without notice', 'restrict access',
                    'violate terms', 'breach agreement', 'disable account',
                    'immediate termination', 'for any reason', 'reserve the right'
                ],
                'display_name': '⚠️ Account Termination Rights'
            },
            'content_rights': {
                'patterns': [
                    r'(?:grant|give) (?:us )?(?:a )?(?:license|right)',
                    r'(?:royalty[- ]?free|worldwide|perpetual) (?:license|right)',
                    r'(?:use|modify|distribute|display) (?:your )?content',
                    r'intellectual property (?:rights?|ownership)',
                    r'user[- ]generated content',
                    r'retain (?:all )?rights? (?:to|in)',
                    r'sublicense (?:your )?content',
                    r'derivative works'
                ],
                'keywords': [
                    'license to use', 'royalty-free license', 'user content rights',
                    'intellectual property', 'worldwide license', 'perpetual license',
                    'modify your content', 'distribute content', 'ownership rights',
                    'sublicense', 'derivative works', 'commercial use'
                ],
                'display_name': '📝 Content & IP Rights'
            },
            'legal_protection': {
                'patterns': [
                    r'(?:limitation of|limit our) liability',
                    r'(?:disclaim|disclaimer) (?:all )?(?:warranties|liability)',
                    r'(?:indemnify|hold (?:us )?harmless)',
                    r'(?:binding )?arbitration',
                    r'class action waiver',
                    r'dispute resolution',
                    r'(?:as[- ]?is|without warranty)',
                    r'consequential damages',
                    r'maximum liability'
                ],
                'keywords': [
                    'limitation of liability', 'no warranty', 'as-is basis',
                    'binding arbitration', 'class action waiver', 'indemnification',
                    'hold harmless', 'dispute resolution', 'disclaim liability',
                    'consequential damages', 'maximum liability', 'legal fees'
                ],
                'display_name': '⚖️ Legal Disclaimers'
            },
            'changes_updates': {
                'patterns': [
                    r'(?:change|modify|update|revise) (?:these )?terms',
                    r'(?:at any time|from time to time)',
                    r'continued use (?:constitutes|means)',
                    r'(?:notify|notice) (?:you )?(?:of|about) changes',
                    r'(?:new|updated) terms (?:will|become) (?:effective|binding)',
                    r'without (?:prior )?notice',
                    r'sole discretion'
                ],
                'keywords': [
                    'change terms', 'modify agreement', 'update policy',
                    'at any time', 'continued use', 'notification of changes',
                    'terms effective', 'policy updates', 'without notice',
                    'sole discretion', 'unilateral changes'
                ],
                'display_name': '📋 Terms Modification Rights'
            }
        }
    
    def clean_text(self, text: str) -> str:
        """Enhanced text cleaning"""
        text = re.sub(r'\s+', ' ', text.strip())
        text = re.sub(r'Last updated:.*?\n', '', text, flags=re.IGNORECASE)
        text = re.sub(r'Effective date:.*?\n', '', text, flags=re.IGNORECASE)
        text = re.sub(r'Print this page.*?\n', '', text, flags=re.IGNORECASE)
        return text[:12000]  # Increased limit for better analysis
    
    def extract_sentences_with_context(self, text: str, patterns: List[str], keywords: List[str]) -> List[str]:
        """Extract relevant sentences using both regex patterns and keywords"""
        text_lower = text.lower()
        sentences = re.split(r'[.!?]+', text)
        found_items = []
        
        # Enhanced pattern matching with better context
        for pattern in patterns:
            matches = re.finditer(pattern, text_lower, re.IGNORECASE)
            for match in matches:
                start_pos = match.start()
                
                # Find sentence containing the match
                for sentence in sentences:
                    if not sentence.strip():
                        continue
                        
                    sentence_start = text_lower.find(sentence.lower().strip())
                    if sentence_start != -1:
                        sentence_end = sentence_start + len(sentence.strip())
                        
                        if sentence_start <= start_pos <= sentence_end:
                            clean_sentence = sentence.strip()
                            if len(clean_sentence) > 30:  # Minimum meaningful length
                                if len(clean_sentence) > 200:
                                    clean_sentence = clean_sentence[:200] + "..."
                                
                                if clean_sentence not in found_items:
                                    found_items.append(clean_sentence)
                                    if len(found_items) >= 5:  # Increased limit
                                        return found_items
                            break
        
        # Keyword matching as fallback and supplement
        if len(found_items) < 3:
            for keyword in keywords:
                if keyword in text_lower:
                    for sentence in sentences:
                        sentence_clean = sentence.strip()
                        if (keyword in sentence_clean.lower() and 
                            len(sentence_clean) > 30 and 
                            sentence_clean not in found_items):
                            
                            if len(sentence_clean) > 200:
                                sentence_clean = sentence_clean[:200] + "..."
                            
                            found_items.append(sentence_clean)
                            if len(found_items) >= 5:
                                break
                    
                    if len(found_items) >= 5:
                        break
        
        return found_items[:5]  # Return max 5 items per category
    
    def analyze_categories(self, text: str) -> Dict:
        """Analyze text for all categories with improved detection"""
        results = {}
        
        for category_key, category_data in self.categories.items():
            items = self.extract_sentences_with_context(
                text, 
                category_data['patterns'], 
                category_data['keywords']
            )
            
            if items:
                results[category_key] = {
                    'display_name': category_data['display_name'],
                    'items': items,
                    'count': len(items)
                }
        
        return results
    
    def calculate_risk_level(self, categories: Dict, text_length: int) -> str:
        """Calculate risk level based on findings"""
        total_concerns = sum(cat['count'] for cat in categories.values())
        sensitive_categories = ['privacy_concerns', 'account_control', 'legal_protection']
        sensitive_count = sum(1 for cat in sensitive_categories if cat in categories)
        
        # Enhanced risk calculation
        if sensitive_count >= 3 and total_concerns >= 12:
            return 'high'
        elif sensitive_count >= 2 and total_concerns >= 8:
            return 'high'
        elif sensitive_count >= 1 and total_concerns >= 6:
            return 'medium'
        elif total_concerns >= 4:
            return 'medium'
        elif total_concerns >= 1:
            return 'low'
        else:
            return 'very_low'
    
    def generate_fallback_summary(self, text: str, categories: Dict) -> str:
        """Generate rule-based summary when API fails"""
        total_concerns = sum(cat['count'] for cat in categories.values())
        category_names = [cat['display_name'].split(' ', 1)[1] for cat in categories.values()]
        
        if total_concerns == 0:
            return "This document appears to contain standard terms with minimal concerning clauses detected."
        
        summary_parts = []
        summary_parts.append(f"Analysis identified {total_concerns} potentially concerning clauses")
        
        if len(category_names) > 0:
            if len(category_names) <= 2:
                summary_parts.append(f"primarily related to {' and '.join(category_names)}")
            else:
                summary_parts.append(f"spanning {', '.join(category_names[:3])}" + 
                                   (f" and {len(category_names)-3} other areas" if len(category_names) > 3 else ""))
        
        # Add specific warnings based on risk level
        risk_warnings = []
        if 'privacy_concerns' in categories:
            risk_warnings.append("third-party data sharing")
        if 'account_control' in categories:
            risk_warnings.append("discretionary account termination")
        if 'payment_terms' in categories:
            risk_warnings.append("billing and subscription obligations")
        if 'legal_protection' in categories:
            risk_warnings.append("liability limitations")
        
        if risk_warnings:
            summary_parts.append(f"Notable concerns include: {', '.join(risk_warnings)}")
        
        return ". ".join(summary_parts) + "."

# Initialize components
analyzer = CategorizedTCAnalyzer()
hf_client = HuggingFaceAPIClient()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'features': ['semantic_analysis', 'huggingface_api_summaries'],
        'api_configured': bool(hf_client.api_key)
    })

@app.route('/summarize', methods=['POST'])
def summarize():
    try:
        data = request.json
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'No text provided'}), 400
        
        if len(text.split()) < 20:
            return jsonify({'error': 'Text too short for analysis (minimum 20 words)'}), 400
        
        print(f"📊 Analyzing document ({len(text.split())} words)...")
        
        # Clean text
        clean_text = analyzer.clean_text(text)
        
        # Perform semantic analysis (always works)
        print("🔍 Performing semantic analysis...")
        categories = analyzer.analyze_categories(clean_text)
        
        # Try to generate AI summary
        print("🤖 Generating AI summary...")
        ai_summary = hf_client.summarize_text(clean_text)
        
        if ai_summary:
            summary_text = ai_summary
            summary_source = 'huggingface_api'
        else:
            summary_text = analyzer.generate_fallback_summary(clean_text, categories)
            summary_source = 'rule_based'
        
        # Calculate risk level
        risk_level = analyzer.calculate_risk_level(categories, len(clean_text))
        total_concerns = sum(cat['count'] for cat in categories.values())
        
        print(f"✅ Analysis complete: {total_concerns} concerns found, risk level: {risk_level}")
        
        return jsonify({
            'summary': summary_text,
            'categories': categories,
            'metadata': {
                'word_count': len(text.split()),
                'total_concerns': total_concerns,
                'risk_level': risk_level,
                'categories_found': len(categories),
                'summary_source': summary_source,
                'analysis_type': 'hybrid'
            }
        })
        
    except Exception as e:
        print(f"❌ Error in summarize: {e}")
        return jsonify({'error': f'Analysis error: {str(e)}'}), 500

@app.route('/categories-only', methods=['POST'])
def categories_only():
    """Fast endpoint for category analysis only"""
    try:
        data = request.json
        text = data.get('text', '')
        
        if not text:
            return jsonify({'error': 'No text provided'}), 400
        
        clean_text = analyzer.clean_text(text)
        categories = analyzer.analyze_categories(clean_text)
        
        risk_level = analyzer.calculate_risk_level(categories, len(clean_text))
        total_concerns = sum(cat['count'] for cat in categories.values())
        
        return jsonify({
            'categories': categories,
            'metadata': {
                'word_count': len(text.split()),
                'total_concerns': total_concerns,
                'risk_level': risk_level,
                'categories_found': len(categories)
            }
        })
        
    except Exception as e:
        print(f"❌ Error in categories_only: {e}")
        return jsonify({'error': f'Analysis error: {str(e)}'}), 500

@app.route('/api-status', methods=['GET'])
def api_status():
    """Check API status and configuration"""
    return jsonify({
        'huggingface_configured': bool(hf_client.api_key),
        'available_models': list(HF_MODELS.keys()),
        'primary_model': HF_MODELS['primary']
    })

if __name__ == '__main__':
    print("🚀 Starting Hybrid T&C Analyzer...")
    print("✨ Features:")
    print("   🔍 Advanced semantic analysis with regex patterns")
    print("   🤖 AI-powered summaries via Hugging Face API")
    print("   🔄 Fallback to rule-based summaries")
    print("   📊 Enhanced risk assessment")
    print("   💾 Memory optimized (no local ML models)")
    print()
    print("🔧 Setup required:")
    if not hf_client.api_key:
        print("   ⚠️  Set HUGGINGFACE_API_KEY environment variable")
        print("   📝 Get free API key: https://huggingface.co/settings/tokens")
    else:
        print("   ✅ Hugging Face API key configured")
    print()
    print("🌐 Endpoints:")
    print("   POST /summarize - Full analysis with AI summary")
    print("   POST /categories-only - Fast semantic analysis only")
    print("   GET /health - Health check")
    print("   GET /api-status - API configuration status")
    
    app.run(host='0.0.0.0', port=5000, debug=False)
