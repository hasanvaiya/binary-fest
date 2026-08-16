// WebApp Application Logic
document.addEventListener('DOMContentLoaded', () => {
  initTabNavigation();
  initBackgroundCanvas();
  initMetricsChart();
  initStudioControls();
  initTaskManager();
  initQuickActions();
});

// 1. Navigation Tab Switcher
function initTabNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');

      navItems.forEach(nav => nav.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      item.classList.add('active');
      const targetContent = document.getElementById(`${tabId}-tab`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
}

// 2. Interactive Background Particle Canvas
function initBackgroundCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const particles = Array.from({ length: 45 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    radius: Math.random() * 2.2 + 0.5,
    dx: (Math.random() - 0.5) * 0.4,
    dy: (Math.random() - 0.5) * 0.4,
    alpha: Math.random() * 0.5 + 0.2
  }));

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
      p.x += p.dx;
      p.y += p.dy;

      if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.dy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(165, 180, 252, ${p.alpha})`;
      ctx.fill();
    });

    requestAnimationFrame(animate);
  }
  animate();
}

// 3. Real-time Metrics Chart Renderer
function initMetricsChart() {
  const canvas = document.getElementById('metricsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let dataPoints = [40, 55, 38, 70, 65, 85, 78, 92, 88, 95, 80, 88];

  function drawChart() {
    const width = canvas.parentElement.clientWidth;
    const height = 240;
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 40; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Chart Gradient Fill
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    ctx.beginPath();
    const step = width / (dataPoints.length - 1);
    ctx.moveTo(0, height - (dataPoints[0] / 100) * (height - 40));

    for (let i = 1; i < dataPoints.length; i++) {
      const x = i * step;
      const y = height - (dataPoints[i] / 100) * (height - 40);
      ctx.lineTo(x, y);
    }

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Chart Stroke Line
    ctx.beginPath();
    ctx.moveTo(0, height - (dataPoints[0] / 100) * (height - 40));
    for (let i = 1; i < dataPoints.length; i++) {
      const x = i * step;
      const y = height - (dataPoints[i] / 100) * (height - 40);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  drawChart();
  window.addEventListener('resize', drawChart);

  // Live updates
  setInterval(() => {
    dataPoints.shift();
    dataPoints.push(Math.floor(Math.random() * 40) + 55);
    drawChart();

    // Update telemetry numbers
    const cpu = Math.floor(Math.random() * 25) + 20;
    const mem = Math.floor(Math.random() * 20) + 40;
    const latency = Math.floor(Math.random() * 10) + 18;

    document.getElementById('cpuLoad').innerText = `${cpu}%`;
    document.getElementById('memLoad').innerText = `${mem}%`;
    document.getElementById('apiLatency').innerText = `${latency}ms`;

    const fills = document.querySelectorAll('.progress-fill');
    if (fills.length >= 3) {
      fills[0].style.width = `${cpu}%`;
      fills[1].style.width = `${mem}%`;
      fills[2].style.width = `${latency * 2}%`;
    }
  }, 2500);

  document.getElementById('refreshMetrics')?.addEventListener('click', () => {
    dataPoints = dataPoints.map(() => Math.floor(Math.random() * 40) + 55);
    drawChart();
    showToast('Metrics refreshed!');
  });
}

// 4. Component Studio Controls
function initStudioControls() {
  const themePicker = document.getElementById('themePicker');
  const glassBlur = document.getElementById('glassBlur');
  const glowIntensity = document.getElementById('glowIntensity');
  const previewCard = document.querySelector('.sample-card');
  const resetBtn = document.getElementById('resetStudioBtn');

  if (!themePicker || !previewCard) return;

  function updatePreview() {
    const color = themePicker.value;
    const blur = glassBlur.value;
    const glow = glowIntensity.value;

    document.documentElement.style.setProperty('--primary', color);
    previewCard.style.backdropFilter = `blur(${blur}px)`;
    previewCard.style.boxShadow = `0 10px 30px rgba(0, 0, 0, 0.4), 0 0 ${glow}px ${color}66`;
  }

  themePicker.addEventListener('input', updatePreview);
  glassBlur.addEventListener('input', updatePreview);
  glowIntensity.addEventListener('input', updatePreview);

  resetBtn?.addEventListener('click', () => {
    themePicker.value = '#6366f1';
    glassBlur.value = '12';
    glowIntensity.value = '60';
    updatePreview();
    showToast('Studio controls reset to default.');
  });
}

// 5. Project Task Board
function initTaskManager() {
  const tasksList = document.getElementById('tasksList');
  const newTaskInput = document.getElementById('newTaskInput');
  const addTaskBtn = document.getElementById('addTaskBtn');

  let tasks = [
    { id: 1, text: 'Initialize WebApp project environment', completed: true },
    { id: 2, text: 'Build responsive glassmorphic UI layout', completed: true },
    { id: 3, text: 'Deploy real-time WebSocket metrics service', completed: false }
  ];

  function renderTasks() {
    if (!tasksList) return;
    tasksList.innerHTML = '';

    tasks.forEach(task => {
      const item = document.createElement('div');
      item.className = 'task-item';
      item.innerHTML = `
        <div class="task-info">
          <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} data-id="${task.id}">
          <span class="task-text ${task.completed ? 'completed' : ''}">${task.text}</span>
        </div>
        <button class="btn-icon delete-task" data-id="${task.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
      `;
      tasksList.appendChild(item);
    });

    // Attach listeners
    document.querySelectorAll('.task-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = parseInt(e.target.getAttribute('data-id'));
        const task = tasks.find(t => t.id === id);
        if (task) {
          task.completed = e.target.checked;
          renderTasks();
        }
      });
    });

    document.querySelectorAll('.delete-task').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(btn.getAttribute('data-id'));
        tasks = tasks.filter(t => t.id !== id);
        renderTasks();
        showToast('Task removed');
      });
    });
  }

  addTaskBtn?.addEventListener('click', () => {
    const text = newTaskInput.value.trim();
    if (text) {
      tasks.push({ id: Date.now(), text, completed: false });
      newTaskInput.value = '';
      renderTasks();
      showToast('New task added!');
    }
  });

  newTaskInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addTaskBtn.click();
    }
  });

  renderTasks();
}

// 6. Quick Actions & Toast Notifications
function initQuickActions() {
  document.getElementById('launchDemoBtn')?.addEventListener('click', () => {
    showToast('Quick Launch initiated successfully!');
  });

  document.getElementById('createProjectBtn')?.addEventListener('click', () => {
    showToast('Creating new project workspace...');
  });

  document.getElementById('pingBtn')?.addEventListener('click', () => {
    showToast('Ping response: 18ms (OK)');
  });

  document.getElementById('purgeCacheBtn')?.addEventListener('click', () => {
    showToast('System cache purged (14.2 MB freed)');
  });
}

function showToast(message) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(18, 24, 38, 0.95);
    border: 1px solid rgba(99, 102, 241, 0.4);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(10px);
    animation: fadeIn 0.3s ease-out;
  `;
  toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #10b981; margin-right: 8px;"></i> ${message}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
