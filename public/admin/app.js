const API_URL = '/api/admin';
let token = localStorage.getItem('adminToken');
let authMode = 'login';

// --- Auth Logic ---
async function login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Login failed');
        saveAuth(data);
    } catch (err) {
        showAuthNotice(
            err.message || 'Network error.',
            'error',
            err.message === 'Email not verified',
            err.message === 'Email not verified'
        );
    }
}

async function registerIsp() {
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');

    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: document.getElementById('isp-name').value,
                email: document.getElementById('email').value,
                password: document.getElementById('password').value
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Account creation failed');
        document.getElementById('password').value = '';
        showAuthNotice(data.message, 'success', true, true);
    } catch (err) {
        showAuthNotice(err.message || 'Network error.', 'error');
    }
}

function showAuthNotice(message, type, canResend = false, showCode = false) {
    const notice = document.getElementById('login-error');
    notice.innerText = message;
    notice.className = `auth-notice ${type}`;
    document.getElementById('resend-verification').classList.toggle('hidden', !canResend);
    document.getElementById('verification-code-field').classList.toggle('hidden', !showCode);
}

async function resendVerification() {
    const email = document.getElementById('email').value;
    try {
        const res = await fetch(`${API_URL}/auth/resend-verification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not resend verification email');
        showAuthNotice(data.message, 'success', true, true);
    } catch (err) {
        showAuthNotice(err.message || 'Network error.', 'error', true, true);
    }
}

async function verifyEmail() {
    const email = document.getElementById('email').value;
    const code = document.getElementById('verification-code').value.trim();
    try {
        const res = await fetch(`${API_URL}/auth/verify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Email verification failed');
        document.getElementById('verification-code').value = '';
        showAuthNotice(data.message, 'success');
    } catch (err) {
        showAuthNotice(err.message || 'Email verification failed', 'error', true, true);
    }
}

function saveAuth(data) {
    localStorage.setItem('adminToken', data.token);
    token = data.token;
    showDashboard();
}

function toggleAuthMode() {
    const isRegistering = authMode === 'login';
    authMode = isRegistering ? 'register' : 'login';
    document.getElementById('register-name-field').classList.toggle('hidden', !isRegistering);
    document.getElementById('auth-submit').textContent = isRegistering ? 'Create ISP account' : 'Login';
    document.getElementById('auth-submit').onclick = isRegistering ? registerIsp : login;
    document.getElementById('auth-toggle-copy').textContent = isRegistering
        ? 'Already have an account?'
        : 'New to Daraja Hotspot?';
    document.getElementById('auth-toggle').textContent = isRegistering ? 'Back to login' : 'Create ISP account';
    document.getElementById('password').autocomplete = isRegistering ? 'new-password' : 'current-password';
    document.getElementById('login-error').classList.add('hidden');
    document.getElementById('resend-verification').classList.add('hidden');
    document.getElementById('verification-code-field').classList.add('hidden');
}

function logout() {
    localStorage.removeItem('adminToken');
    token = null;
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

function showDashboard() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    loadStats();
    loadPlans();
    loadRouters();
    loadMpesaSettings();
}

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// --- Dashboard Logic ---
async function loadStats() {
    try {
        const res = await fetch(`${API_URL}/stats`, { headers: getHeaders() });
        if (res.status === 401) return logout(); 
        
        const data = await res.json();
        if (data.success) {
            document.getElementById('stat-revenue').innerText = `KES ${data.data.total_revenue}`;
            document.getElementById('stat-tx').innerText = data.data.total_transactions;
            document.getElementById('stat-routers').innerText = data.data.online_routers;
        }
    } catch (err) { console.error(err); }
}

async function loadPlans() {
    try {
        const res = await fetch(`${API_URL}/plans`, { headers: getHeaders() });
        const data = await res.json();
        
        if (data.success) {
            const list = document.getElementById('plans-list');
            list.innerHTML = '';
            
            if (data.data.length === 0) {
                list.innerHTML = '<p>No plans created yet.</p>';
            }

            data.data.forEach(plan => {
                const div = document.createElement('div');
                div.className = 'plan-item';
                const summary = document.createElement('div');
                const name = document.createElement('strong');
                name.textContent = plan.name;
                summary.append(name, document.createTextNode(
                    ` - KES ${plan.price} (${plan.duration_min} mins)${plan.active ? '' : ' (Archived)'}`
                ));
                const profile = document.createElement('div');
                profile.style.color = '#6b7280';
                profile.style.fontSize = '14px';
                profile.textContent = `Profile: ${plan.mikrotik_profile}`;
                const editButton = createActionButton('Edit', () => editPlan(plan));
                const archiveButton = createActionButton(
                    plan.active ? 'Archive' : 'Reactivate',
                    () => setPlanActive(plan, !plan.active)
                );
                div.append(summary, profile, editButton, archiveButton);
                list.appendChild(div);
            });
        }
    } catch (err) { console.error(err); }
}

async function editPlan(plan) {
    const name = prompt('Plan name', plan.name);
    if (name === null) return;
    const price = prompt('Price (KES)', plan.price);
    if (price === null) return;
    const durationMin = prompt('Duration (minutes)', plan.duration_min);
    if (durationMin === null) return;
    const profile = prompt('MikroTik profile', plan.mikrotik_profile);
    if (profile === null) return;

    await savePlan(plan, { name, price, durationMin, profile });
}

async function setPlanActive(plan, active) {
    if (!active && !confirm(`Archive "${plan.name}"? Existing transactions will be retained.`)) return;
    await savePlan(plan, {
        name: plan.name,
        price: plan.price,
        durationMin: plan.duration_min,
        profile: plan.mikrotik_profile,
        active
    });
}

async function savePlan(plan, updates) {
    try {
        const res = await fetch(`${API_URL}/plans/${plan.id}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update plan');
        await loadPlans();
    } catch (err) {
        alert(`Failed to update plan: ${err.message}`);
    }
}

function createActionButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.margin = '8px 8px 0 0';
    button.addEventListener('click', action);
    return button;
}

// --- Settings Logic ---
async function loadMpesaSettings() {
    const statusEl = document.getElementById('mpesa-status');
    try {
        const res = await fetch(`${API_URL}/settings/mpesa`, { headers: getHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load settings');
        statusEl.textContent = data.data.configured
            ? `M-Pesa is configured for shortcode ${data.data.mpesa_shortcode}.`
            : 'M-Pesa is not configured.';
        statusEl.className = 'status';
        document.getElementById('mpesa-shortcode').value = data.data.mpesa_shortcode || '';
    } catch (err) {
        statusEl.textContent = `Failed to load M-Pesa settings: ${err.message}`;
        statusEl.className = 'status error';
    }
}

async function saveMpesaSettings() {
    const shortcode = document.getElementById('mpesa-shortcode').value;
    const consumerKey = document.getElementById('mpesa-key').value;
    const consumerSecret = document.getElementById('mpesa-secret').value;
    const passkey = document.getElementById('mpesa-passkey').value;
    const statusEl = document.getElementById('mpesa-status');

    statusEl.classList.add('hidden');

    try {
        const res = await fetch(`${API_URL}/settings/mpesa`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ shortcode, consumerKey, consumerSecret, passkey })
        });
        
        const data = await res.json();
        
        if (data.success) {
            statusEl.innerText = "✅ M-Pesa settings saved and encrypted successfully.";
            statusEl.className = "status success";
            document.getElementById('mpesa-key').value = '';
            document.getElementById('mpesa-secret').value = '';
            document.getElementById('mpesa-passkey').value = '';
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        statusEl.innerText = `❌ Failed: ${err.message}`;
        statusEl.className = "status error";
    }
}

async function clearMpesaSettings() {
    if (!confirm('Clear the stored M-Pesa credentials for this ISP?')) return;
    const statusEl = document.getElementById('mpesa-status');
    try {
        const res = await fetch(`${API_URL}/settings/mpesa`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to clear settings');
        document.getElementById('mpesa-shortcode').value = '';
        document.getElementById('mpesa-key').value = '';
        document.getElementById('mpesa-secret').value = '';
        document.getElementById('mpesa-passkey').value = '';
        statusEl.textContent = 'M-Pesa settings cleared.';
        statusEl.className = 'status success';
    } catch (err) {
        statusEl.textContent = `Failed to clear settings: ${err.message}`;
        statusEl.className = 'status error';
    }
}

// --- Plan Creation Logic ---
async function createPlan() {
    const name = document.getElementById('plan-name').value;
    const price = document.getElementById('plan-price').value;
    const durationMin = document.getElementById('plan-duration').value;
    const profile = document.getElementById('plan-profile').value;

    if (!name || !price || !durationMin || !profile) {
        alert("Please fill in all fields");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/plans`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name, price, durationMin, profile })
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert("Plan created successfully!");
            document.getElementById('plan-name').value = '';
            document.getElementById('plan-price').value = '';
            document.getElementById('plan-duration').value = '';
            document.getElementById('plan-profile').value = '';
            loadPlans();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (err) { console.error(err); }
}

// --- Router Setup Script Generation ---
async function loadRouters() {
    const list = document.getElementById('routers-list');
    try {
        const res = await fetch(`${API_URL}/routers`, { headers: getHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load routers');
        list.replaceChildren();
        if (data.data.length === 0) {
            list.textContent = 'No routers registered yet.';
            return;
        }

        data.data.forEach(router => {
            const row = document.createElement('div');
            row.className = 'plan-item';
            const summary = document.createElement('div');
            summary.textContent = `${router.name} (${router.local_ip}) — ${router.health}${router.active ? '' : ' (Archived)'}`;
            row.appendChild(summary);
            row.append(
                createActionButton('Edit', () => editRouter(router)),
                createActionButton(
                    router.active ? 'Archive' : 'Reactivate',
                    () => setRouterActive(router, !router.active)
                )
            );
            list.appendChild(row);
        });
    } catch (err) {
        list.textContent = `Failed to load routers: ${err.message}`;
    }
}

async function editRouter(router) {
    const name = prompt('Router name', router.name);
    if (name === null) return;
    const localIp = prompt('Router local IP', router.local_ip);
    if (localIp === null) return;
    await saveRouter(router, { name, localIp });
}

async function setRouterActive(router, active) {
    if (!active && !confirm(`Archive "${router.name}"? Existing transaction history will be retained.`)) return;
    await saveRouter(router, { name: router.name, localIp: router.local_ip, active });
}

async function saveRouter(router, updates) {
    try {
        const res = await fetch(`${API_URL}/routers/${router.id}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update router');
        await loadRouters();
    } catch (err) {
        alert(`Failed to update router: ${err.message}`);
    }
}

async function generateRouter() {
    const name = document.getElementById('router-name').value;
    if (!name) return alert("Enter a router name");

    try {
        const res = await fetch(`${API_URL}/routers`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name })
        });
        
        const data = await res.json();
        if (data.success) {
            document.getElementById('script-container').classList.remove('hidden');
            document.getElementById('router-script').value = data.data.script;
            await loadRouters();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (err) { console.error(err); }
}

function copyScript() {
    const textarea = document.getElementById('router-script');
    textarea.select();
    document.execCommand('copy');
    alert("Script copied to clipboard!");
}

if (token) showDashboard();