const startBtn = document.getElementById('startBtn');
const loader = document.getElementById('loader');
const resultsArea = document.getElementById('results');
const clientInput = document.getElementById('clientInput');

// UI Elements to fill
const ui = {
    url: document.getElementById('urlOutput'),
    mood: document.getElementById('mood'),
    gsap: document.getElementById('gsap'),
    advice: document.getElementById('advice'),
    fonts: document.getElementById('fonts')
};

startBtn.addEventListener('click', analyzeBrand);

// Allow "Enter" key to submit
clientInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') analyzeBrand();
});

// NEW: Toggle Function
function toggleButtons() {
    const container = document.getElementById('buttons-container');
    const icon = document.getElementById('btn-toggle-icon');

    if (container.style.display === 'none') {
        container.style.display = 'block';
        icon.innerText = '[-]';
    } else {
        container.style.display = 'none';
        icon.innerText = '[+]';
    }
}

async function analyzeBrand() {
    const inputVal = clientInput.value.trim();
    if (!inputVal) return;

    // 1. Reset & Show Loader
    resultsArea.classList.add('hidden');
    loader.classList.remove('hidden');
    startBtn.disabled = true;
    startBtn.innerText = "SCANNING...";

    // Fake percentage loader
    let percent = 0;
    const interval = setInterval(() => {
        if (percent < 90) {
            percent += Math.floor(Math.random() * 10);
            document.querySelector('.percent').innerText = percent + "%";
        }
    }, 500);

    try {
        // 2. Call API
        const response = await fetch('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientInput: inputVal })
        });

        const data = await response.json();

        // --- NEW SAFETY CHECK ---
        if (data.error) {
            throw new Error(data.error); // Stop execution if server reported error
        }
        
        // Check if analysis exists before reading 'mood'
        if (!data.analysis) {
            data.analysis = { 
                mood: "Data Unavailable", 
                gsap_ease: "none", 
                animation_advice: "Could not analyze." 
            };
        }
        // ------------------------

        // 3. Populate UI
        ui.url.innerHTML = `<a href="${data.url}" target="_blank" style="color:white;">${data.url}</a> [STATUS: 200 OK]`;
        
        ui.mood.innerText = `"${data.analysis.mood}"`;
        ui.gsap.innerText = `ease: "${data.analysis.gsap_ease}"`;
        ui.advice.innerText = `> ${data.analysis.animation_advice}`;

        // --- NEW BUTTON LIST LOGIC ---
        const btnContainer = document.getElementById('buttons-container');
        btnContainer.innerHTML = ''; // Clear previous

        if (data.buttons && data.buttons.length > 0) {
            const list = document.createElement('div');
            list.className = 'button-list';

            data.buttons.forEach(btn => {
                const def = btn.defaultStyle;
                const hov = btn.hoverStyle || def; // Fallback if hover failed

                const item = document.createElement('div');
                item.className = 'button-item';
                item.innerHTML = `
                    <div style="text-align:center;">
                        <div class="preview-box" style="background:${def.bg}; color:${def.color}; border-radius:${def.radius}">
                            ${btn.text || "BTN"}
                        </div>
                        <div style="font-size:9px; margin-top:4px; color:#666;">DEFAULT</div>
                    </div>

                    <div style="color: #444;">→</div>

                    <div style="text-align:center;">
                        <div class="preview-box" style="background:${hov.bg}; color:${hov.color}; border-radius:${def.radius}">
                            ${btn.text || "BTN"}
                        </div>
                        <div style="font-size:9px; margin-top:4px; color:#666;">HOVER</div>
                    </div>

                    <div class="btn-details">
                        <div class="color-row">
                            <span>BG:</span> <span class="code-block">${def.bg}</span>
                        </div>
                        <div class="color-row">
                            <span>Font:</span> <span>${def.font}</span>
                        </div>
                         <div class="color-row">
                            <span>Radius:</span> <span>${def.radius}</span>
                        </div>
                    </div>
                `;
                list.appendChild(item);
            });
            btnContainer.appendChild(list);

        } else {
            btnContainer.innerHTML = '<div style="padding:10px; color:#777;">No buttons detected.</div>';
        }

        // Populate Fonts
        ui.fonts.innerHTML = '';
        if (data.fonts && data.fonts.length > 0) {
            data.fonts.forEach(f => {
                const name = f.split('/').pop().split('?')[0];
                const link = document.createElement('a');
                link.href = f;
                link.className = 'tag';
                link.target = '_blank';
                link.innerText = name.length > 25 ? name.substring(0, 20) + '...' : name;
                ui.fonts.appendChild(link);
            });
        } else {
            ui.fonts.innerHTML = '<span style="color:#555">// No direct .woff2 files detected</span>';
        }

        // 4. Reveal
        clearInterval(interval);
        document.querySelector('.percent').innerText = "100%";
        setTimeout(() => {
            loader.classList.add('hidden');
            resultsArea.classList.remove('hidden');
            startBtn.disabled = false;
            startBtn.innerText = "INITIALIZE_SCAN()";
        }, 500);

    } catch (e) {
        clearInterval(interval);
        alert("CRITICAL ERROR: " + e.message);
        loader.classList.add('hidden');
        startBtn.disabled = false;
        startBtn.innerText = "INITIALIZE_SCAN()";
    }
}