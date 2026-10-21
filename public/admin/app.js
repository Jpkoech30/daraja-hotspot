const API_URL = '/api/admin';
let token = localStorage.getItem('adminToken');

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
        
        if (data.success) {
            localStorage.setItem('adminToken', data.token);
            token = data.token;
            showDashboard();
        } else {
            errorEl.innerText = data.error || "Login failed";
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.innerText = "Network error.";
        errorEl.classList.remove('hidden');
    }
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
                div.innerHTML = `
                    <div>
                        <strong>${plan.name}</strong> - KES ${plan.price} (${plan.duration_min} mins)
                    </div>
                    <div style="color: #6b7280; font-size: 14px;">Profile: ${plan.mikrotik_profile}</div>
                `;
                list.appendChild(div);
            });
        }
    } catch (err) { console.error(err); }
}

// --- Settings Logic ---
async function saveMpesaSettings() {
    const shortcode = document.getElementById('mpesa-shortcode').value;
    const consumerKey = document.getElementById('mpesa-key').value;
    const consumerSecret = document.getElementById('mpesa-secret').value;
    const statusEl = document.getElementById('mpesa-status');

    statusEl.classList.add('hidden');

    try {
        const res = await fetch(`${API_URL}/settings/mpesa`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ shortcode, consumerKey, consumerSecret })
        });
        
        const data = await res.json();
        
        if (data.success) {
            statusEl.innerText = "✅ M-Pesa settings saved and encrypted successfully.";
            statusEl.className = "status success";
            document.getElementById('mpesa-key').value = '';
            document.getElementById('mpesa-secret').value = '';
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        statusEl.innerText = `❌ Failed: ${err.message}`;
        statusEl.className = "status error";
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

// Check login on load
if (token) {
    showDashboard();
}