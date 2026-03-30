const express = require('express');
const app = express();
const PORT = 3000;
import { SpeedInsights } from "@vercel/speed-insights/next"
// Middleware для парсинга JSON
app.use(express.json());

// Хранилище веса (null по умолчанию)
let lastWeight = null;

// --- API ЭНДПОИНТЫ ---

// 1. Приём веса (POST)
app.post('/weight', (req, res) => {
    const { grams } = req.body;

    // Проверка: прислали ли нам вообще число?
    if (grams === undefined || typeof grams !== 'number') {
        console.error(`[${new Date().toLocaleTimeString()}] Ошибка: Получены некорректные данные`);
        return res.status(400).json({ error: 'Необходим параметр grams (число)' });
    }

    lastWeight = grams;
    console.log(`[${new Date().toLocaleTimeString()}] Данные обновлены: ${lastWeight} г`);

    // Возвращаем статус 201 (Created), так как мы создали/обновили ресурс
    res.status(201).json({ status: 'success', message: 'Weight updated' });
});

// 2. Чтение веса (GET)
app.get('/weight', (req, res) => {
    if (lastWeight === null) {
        // Статус 204 (No Content) или 404 — данные еще не поступили
        return res.status(200).json({ grams: null, status: 'waiting_for_device' });
    }

    // Явный статус 200 (OK)
    res.status(200).json({ grams: lastWeight, status: 'active' });
});

// --- ВИЗУАЛИЗАЦИЯ (ФРОНТЕНД) ---

app.get('/', (req, res) => {
    console.log(`[${new Date().toLocaleTimeString()}] Новый пользователь зашел на страницу мониторинга`);
    console.log(req.query);
    res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Weight Monitor</title>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f9; }
            .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
            #w { font-size: 3rem; margin: 10px 0; transition: color 0.3s; }
            .status { font-size: 0.9rem; color: #666; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Мониторинг веса</h1>
            <div id="w">Загрузка...</div>
            <div id="status" class="status">Инициализация...</div>
        </div>

        <script>
            async function updateWeight() {
                try {
                    const r = await fetch('/weight');
                    
                    if (!r.ok) throw new Error('Ошибка сервера');
                    
                    const d = await r.json();
                    const display = document.getElementById('w');
                    const statusText = document.getElementById('status');

                    if (d.grams === null) {
                        display.innerText = '---';
                        display.style.color = '#ccc';
                        statusText.innerText = 'Статус: Ожидание данных от весов...';
                    } else {
                        display.innerText = d.grams + ' г';
                        display.style.color = '#2ecc71';
                        statusText.innerText = 'Статус: Онлайн';
                    }
                } catch (err) {
                    document.getElementById('w').innerText = 'ОШИБКА';
                    document.getElementById('w').style.color = '#e74c3c';
                    document.getElementById('status').innerText = 'Статус: Нет связи с сервером';
                }
            }

            setInterval(updateWeight, 500);
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => {
    console.log('-------------------------------------------');
    console.log(`СЕРВЕР ЗАПУЩЕН НА ПОРТУ: ${PORT}`);
    console.log(`Адрес: http://localhost:${PORT}`);
    console.log('-------------------------------------------');
});