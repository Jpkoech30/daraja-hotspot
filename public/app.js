const queryParams = new URLSearchParams(window.location.search);
const TENANT_ID = queryParams.get('tenantId');
const ROUTER_ID = queryParams.get('routerId');
const MAC_ADDRESS = queryParams.get('mac');

let selectedPlan = null;
let statusInterval = null;

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
                <span class="plan-name">${plan.name}</span>
                <span class="plan-price">KES ${plan.price}</span>
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
    document.getElementById('selected-plan-price').innerText = `KES ${plan.price}`;
}

// 3. Initiate Payment
async function initiatePayment() {
    const phone = document.getElementById('phone').value;
    if (!phone || phone.length < 9) {
        alert("Please enter a valid M-Pesa number");
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
                phone: phone,
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
                document.getElementById('status-message').innerText = "✅ Payment successful! You are now online.";
                document.getElementById('status-message').className = "status success";
                document.getElementById('pay-btn').innerText = "Connected!";
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

// Load on startup
loadPlans();