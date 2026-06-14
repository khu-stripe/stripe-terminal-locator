// Import Authentication functions
import {
    initializeAuth,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    signOutUser,
    getCurrentUser,
    getCurrentUserProfile,
    isAuthenticated,
    getUserReferralCode,
    generateNewReferralCode,
    updateUserNickname
} from './supabase-auth.js';

// DOM elements
const authRequiredSection = document.getElementById('authRequiredSection');
const referralContent = document.getElementById('referralContent');
const referralStatsLarge = document.getElementById('referralStatsLarge');
const referralCodeInput = document.getElementById('referralCodeInput');
const copyReferralBtn = document.getElementById('copyReferralBtn');
const generateNewCodeBtn = document.getElementById('generateNewCodeBtn');
const shareReferralBtn = document.getElementById('shareReferralBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const signInPromptBtn = document.getElementById('signInPromptBtn');
// QR Code elements
const generateQRBtn = document.getElementById('generateQRBtn');
const qrCodeSection = document.getElementById('qrCodeSection');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const downloadQRBtn = document.getElementById('downloadQRBtn');
const hideQRBtn = document.getElementById('hideQRBtn');

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Firebase Authentication
    initializeAuth();
    
    // Setup event listeners
    setupEventListeners();
    setupAuthEventListeners();
    setupReferralEventListeners();
    
    // Load referral data if user is authenticated
    setTimeout(async () => {
        if (isAuthenticated()) {
            await loadUserReferralData();
            showReferralContent();
        } else {
            showAuthRequired();
        }
    }, 1000); // Give auth time to initialize
});

// Setup event listeners for referral functionality
function setupReferralEventListeners() {
    // Copy referral code button
    if (copyReferralBtn) {
        copyReferralBtn.addEventListener('click', async () => {
            const referralCode = referralCodeInput.value;
            if (referralCode) {
                await copyToClipboard(referralCode);
                showNotification('Referral code copied to clipboard!', 'success');
            }
        });
    }

    // Generate new referral code button
    if (generateNewCodeBtn) {
        generateNewCodeBtn.addEventListener('click', async () => {
            const user = getCurrentUser();
            if (user) {
                try {
                    showLoading(true);
                    const result = await generateNewReferralCode(user.uid);
                    if (result && result.referralCode) {
                        referralCodeInput.value = result.referralCode;
                        showNotification('New referral code generated!', 'success');
                    }
                } catch (error) {
                    showNotification('Failed to generate new code', 'error');
                } finally {
                    showLoading(false);
                }
            }
        });
    }

    // Share referral link button
    if (shareReferralBtn) {
        shareReferralBtn.addEventListener('click', () => {
            shareReferralLink();
        });
    }

    // Copy link button
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            const referralCode = referralCodeInput.value;
            if (referralCode) {
                const referralUrl = `${window.location.origin}?ref=${referralCode}`;
                copyToClipboard(referralUrl);
                showNotification('Referral link copied to clipboard!', 'success');
            }
        });
    }

    // Sign in prompt button
    if (signInPromptBtn) {
        signInPromptBtn.addEventListener('click', () => {
            document.getElementById('authModal').style.display = 'block';
        });
    }

    // Generate QR Code button
    if (generateQRBtn) {
        generateQRBtn.addEventListener('click', () => {
            const referralCode = referralCodeInput.value;
            if (referralCode) {
                generateQRCode(referralCode);
            } else {
                showNotification('No referral code available', 'error');
            }
        });
    }

    // Download QR Code button
    if (downloadQRBtn) {
        downloadQRBtn.addEventListener('click', () => {
            downloadQRCode();
        });
    }

    // Hide QR Code button
    if (hideQRBtn) {
        hideQRBtn.addEventListener('click', () => {
            hideQRCode();
        });
    }
}

// Setup basic event listeners
function setupEventListeners() {
    // Modal close buttons
    const modalCloses = document.querySelectorAll('.modal .close');
    modalCloses.forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });

    // Click outside modal to close
    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });
}

// Setup authentication event listeners
function setupAuthEventListeners() {
    // Auth button
    const authButton = document.getElementById('authButton');
    if (authButton) {
        authButton.addEventListener('click', function() {
            document.getElementById('authModal').style.display = 'block';
        });
    }

    // Google Sign In buttons
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const googleSignUpBtn = document.getElementById('googleSignUpBtn');
    
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async () => {
            await signInWithGoogle();
        });
    }
    
    if (googleSignUpBtn) {
        googleSignUpBtn.addEventListener('click', async () => {
            await signInWithGoogle();
        });
    }

    // Email sign in form
    const emailSignInForm = document.getElementById('emailSignInForm');
    if (emailSignInForm) {
        emailSignInForm.addEventListener('submit', handleEmailSignIn);
    }

    // Email sign up form
    const emailSignUpForm = document.getElementById('emailSignUpForm');
    if (emailSignUpForm) {
        emailSignUpForm.addEventListener('submit', handleEmailSignUp);
    }

    // Nickname form
    const nicknameForm = document.getElementById('nicknameForm');
    if (nicknameForm) {
        nicknameForm.addEventListener('submit', handleNicknameSubmit);
    }
}

// Load and display user's referral data
async function loadUserReferralData() {
    const user = getCurrentUser();
    if (!user) return;

    try {
        showLoading(true);
        const result = await getUserReferralCode(user.uid);
        if (result) {
            if (referralCodeInput) {
                referralCodeInput.value = result.referralCode;
            }
            
            if (referralStatsLarge) {
                const count = result.referralCount || 0;
                referralStatsLarge.textContent = count;
            }
        }
    } catch (error) {
        console.error('Error loading referral data:', error);
        showNotification('Failed to load referral data', 'error');
    } finally {
        showLoading(false);
    }
}

// Show referral content for authenticated users
function showReferralContent() {
    if (authRequiredSection) authRequiredSection.style.display = 'none';
    if (referralContent) referralContent.style.display = 'block';
}

// Show auth required message for non-authenticated users
function showAuthRequired() {
    if (referralContent) referralContent.style.display = 'none';
    if (authRequiredSection) authRequiredSection.style.display = 'block';
}

// Share referral link
function shareReferralLink() {
    const referralCode = referralCodeInput.value;
    if (!referralCode) return;
    
    const referralUrl = `${window.location.origin}?ref=${referralCode}`;
    
    if (navigator.share) {
        // Use native sharing if available
        navigator.share({
            title: 'Join Stripe Terminal Locator',
            text: 'Help me map Stripe terminal locations worldwide!',
            url: referralUrl
        }).catch(console.error);
    } else {
        // Fallback: copy URL to clipboard
        copyToClipboard(referralUrl);
        showNotification('Referral link copied to clipboard!', 'success');
    }
}

// Copy text to clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }
}

// Handle email sign in
async function handleEmailSignIn(event) {
    event.preventDefault();
    
    const email = document.getElementById('signinEmail').value;
    const password = document.getElementById('signinPassword').value;
    
    const result = await signInWithEmail(email, password);
    if (result.success) {
        document.getElementById('authModal').style.display = 'none';
        setTimeout(async () => {
            await loadUserReferralData();
            showReferralContent();
        }, 1000);
    }
}

// Handle email sign up
async function handleEmailSignUp(event) {
    event.preventDefault();
    
    const nickname = document.getElementById('signupNickname').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    
    const result = await signUpWithEmail(email, password, nickname);
    if (result.success) {
        document.getElementById('authModal').style.display = 'none';
        setTimeout(async () => {
            await loadUserReferralData();
            showReferralContent();
        }, 1000);
    }
}

// Handle nickname submission
async function handleNicknameSubmit(event) {
    event.preventDefault();
    
    const nickname = document.getElementById('userNickname').value.trim();
    
    if (!nickname) {
        showNotification('Please enter a nickname', 'error');
        return;
    }
    
    const user = getCurrentUser();
    if (user) {
        try {
            await updateUserNickname(user.uid, nickname);
            document.getElementById('nicknameModal').style.display = 'none';
            showNotification('Profile updated successfully!', 'success');
            setTimeout(async () => {
                await loadUserReferralData();
                showReferralContent();
            }, 500);
        } catch (error) {
            showNotification('Failed to update profile', 'error');
        }
    }
}

// Switch authentication tabs
window.switchAuthTab = function(tab) {
    const signinTab = document.getElementById('signinTab');
    const signupTab = document.getElementById('signupTab');
    const signinForm = document.getElementById('signinForm');
    const signupForm = document.getElementById('signupForm');
    
    if (tab === 'signin') {
        signinTab.classList.add('active');
        signupTab.classList.remove('active');
        signinForm.style.display = 'block';
        signupForm.style.display = 'none';
    } else {
        signupTab.classList.add('active');
        signinTab.classList.remove('active');
        signupForm.style.display = 'block';
        signinForm.style.display = 'none';
    }
};

// Show loading spinner
function showLoading(show) {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.style.display = show ? 'flex' : 'none';
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '1rem 1.5rem',
        borderRadius: '8px',
        color: 'white',
        fontWeight: '600',
        zIndex: '10000',
        transform: 'translateX(400px)',
        transition: 'transform 0.3s ease',
        backgroundColor: type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'
    });
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove
    setTimeout(() => {
        notification.style.transform = 'translateX(400px)';
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// QR Code functionality
let currentQRCodeCanvas = null;

// Generate QR Code
async function generateQRCode(referralCode) {
    try {
        if (!referralCode) {
            showNotification('No referral code available', 'error');
            return;
        }

        // Construct the referral URL
        const referralUrl = `${window.location.origin}?ref=${referralCode}`;
        
        // Clear existing QR code
        qrCodeContainer.innerHTML = '';
        
        // Show loading state
        qrCodeContainer.innerHTML = '<div style="color: #6c757d;">Generating QR code...</div>';
        
        // Create QR code using qrcode-generator library
        const qr = qrcode(0, 'M');
        qr.addData(referralUrl);
        qr.make();
        
        // Create canvas element
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size
        const size = 200;
        const cellSize = size / qr.getModuleCount();
        canvas.width = size;
        canvas.height = size;
        
        // Fill background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        
        // Draw QR code
        ctx.fillStyle = '#2c3e50';
        for (let row = 0; row < qr.getModuleCount(); row++) {
            for (let col = 0; col < qr.getModuleCount(); col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
                }
            }
        }
        
        // Store reference for download
        currentQRCodeCanvas = canvas;
        
        // Clear loading and add canvas
        qrCodeContainer.innerHTML = '';
        qrCodeContainer.appendChild(canvas);
        
        // Show QR code section with animation
        qrCodeSection.style.display = 'block';
        
        showNotification('QR code generated successfully!', 'success');
        
    } catch (error) {
        console.error('Error generating QR code:', error);
        qrCodeContainer.innerHTML = '<div style="color: #e74c3c;">Failed to generate QR code</div>';
        showNotification('Failed to generate QR code', 'error');
    }
}

// Download QR Code
function downloadQRCode() {
    if (!currentQRCodeCanvas) {
        showNotification('No QR code to download', 'error');
        return;
    }
    
    try {
        // Create download link
        const link = document.createElement('a');
        link.download = `referral-qr-code-${referralCodeInput.value}.png`;
        link.href = currentQRCodeCanvas.toDataURL('image/png');
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showNotification('QR code downloaded successfully!', 'success');
        
    } catch (error) {
        console.error('Error downloading QR code:', error);
        showNotification('Failed to download QR code', 'error');
    }
}

// Hide QR Code
function hideQRCode() {
    qrCodeSection.style.display = 'none';
    currentQRCodeCanvas = null;
    qrCodeContainer.innerHTML = '';
}
