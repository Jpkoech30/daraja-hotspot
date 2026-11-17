const queryParams = new URLSearchParams(window.location.search);
const TENANT_ID = queryParams.get('tenantId');
const ROUTER_ID = queryParams.get('routerId');
const MAC_ADDRESS = queryParams.get('mac');
const ROUTER_LOGIN_URL = queryParams.get('loginUrl');
const ORIGINAL_URL = queryParams.get('dst') || '';

let selectedPlan = null;
let statusInterval = null;

function formatKES(amount) {
    return new Intl.NumberFormat('en-KE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(Number(amount));
}

function formatDuration(minutes) {
    if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} access`;
    if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} access`;
    return `${minutes} minute${minutes === 1 ? '' : 's'} access`;
}

// 1. Fetch plans on load
async function loadPlans() {
    try {
        const res = await fetch(`/api/portal/plans/${TENANT_ID}`);
        const result = await res.json();
        
        if (!result.success) throw new Error("Failed to load plans");

        const container = document.getElementById('plans-container');
        container.innerHTML = ''; // Clear loading state

        result.data.forEach(plan => {
            const div = document.createElement('div');
            div.className = 'plan-card';
            div.innerHTML = `
                <span class="plan-info">
                    <span class="plan-name">${plan.name}</span>
                    <span class="plan-duration">${formatDuration(Number(plan.durationMin))}</span>
                </span>
                <span class="plan-price">KES ${formatKES(plan.price)}</span>
            `;
            div.onclick = () => selectPlan(plan, div);
            container.appendChild(div);
        });
    } catch (error) {
        document.getElementById('plans-container').innerHTML = `<p style="color:red; text-align:center;">Error loading plans.</p>`;
    }
}

// 2. Select a plan
function selectPlan(plan, element) {
    selectedPlan = plan;
    
    // UI Updates
    document.querySelectorAll('.plan-card').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    
    document.getElementById('checkout-section').classList.remove('hidden');
    document.getElementById('selected-plan-name').innerText = plan.name;
    document.getElementById('selected-plan-price').innerText = `KES ${formatKES(plan.price)}`;
    document.getElementById('selected-plan-duration').innerText = formatDuration(Number(plan.durationMin));
}

// 3. Initiate Payment
async function initiatePayment() {
    const phone = document.getElementById('phone').value;
    const digits = phone.replace(/\D/g, '');
    const normalizedPhone = digits.startsWith('0')
        ? `254${digits.slice(1)}`
        : digits.startsWith('254')
            ? digits
            : `254${digits}`;
    if (!/^254(?:7|1)\d{8}$/.test(normalizedPhone)) {
        document.getElementById('status-message').innerText =
            'Enter a valid Kenyan Safaricom number, such as 07XX XXX XXX or +254 7XX XXX XXX.';
        document.getElementById('status-message').className = 'status error';
        return;
    }

    const btn = document.getElementById('pay-btn');
    btn.disabled = true;
    btn.innerText = "Sending STK Push...";
    
    const statusMsg = document.getElementById('status-message');
    statusMsg.innerText = "Check your phone for the M-Pesa prompt...";
    statusMsg.className = "status";

    try {
        const res = await fetch(`/api/portal/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenantId: TENANT_ID,
                routerId: ROUTER_ID,
                planId: selectedPlan.id,
                phone: normalizedPhone,
                macAddress: MAC_ADDRESS
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            startPolling(data.checkoutId);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        statusMsg.innerText = "Payment initiation failed. Try again.";
        statusMsg.className = "status error";
        btn.disabled = false;
        btn.innerText = "Pay with M-Pesa";
    }
}

// 4. Poll Status
function startPolling(checkoutId) {
    statusInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/portal/checkout/status/${checkoutId}`);
            const data = await res.json();

            if (data.status === 'SUCCESS') {
                clearInterval(statusInterval);
                document.getElementById('status-message').innerText = "Payment received. Connecting your Wi-Fi access...";
                document.getElementById('status-message').className = "status success";
                document.getElementById('pay-btn').innerText = "Connecting...";
                waitForProvisioning(checkoutId);
            } else if (data.status === 'FAILED') {
                clearInterval(statusInterval);
                document.getElementById('status-message').innerText = "❌ Payment failed or cancelled.";
                document.getElementById('status-message').className = "status error";
                
                const btn = document.getElementById('pay-btn');
                btn.disabled = false;
                btn.innerText = "Try Again";
            }
        } catch (error) {
            console.error("Polling error", error);
        }
    }, 3000); 
}

async function waitForProvisioning(checkoutId, attempts = 0) {
    if (attempts >= 40) {
        document.getElementById('status-message').innerText =
            "Payment succeeded, but the router is taking longer than expected. Please wait or contact the ISP.";
        document.getElementById('status-message').className = "status error";
        return;
    }

    try {
        const query = new URLSearchParams({
            mac: MAC_ADDRESS || '',
            loginUrl: ROUTER_LOGIN_URL || ''
        });
        const res = await fetch(`/api/portal/checkout/access/${encodeURIComponent(checkoutId)}?${query}`);
        if (res.status === 202) {
            window.setTimeout(() => waitForProvisioning(checkoutId, attempts + 1), 3000);
            return;
        }
        const access = await res.json();
        if (!res.ok) throw new Error(access.error || 'Router could not finish provisioning.');

        if (!access.ready || !ROUTER_LOGIN_URL) {
            document.getElementById('status-message').innerText =
                "Payment successful. Reconnect to the Wi-Fi network to finish signing in.";
            return;
        }

        document.getElementById('status-message').innerText = "Payment successful. Signing you in...";
        const form = document.createElement('form');
        form.method = 'post';
        form.action = access.loginUrl;
        [
            ['username', access.username],
            ['password', access.password],
            ['dst', ORIGINAL_URL]
        ].forEach(([name, value]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
    } catch (error) {
        document.getElementById('status-message').innerText = error.message;
        document.getElementById('status-message').className = "status error";
    }
}

// Load on startup
loadPlans();