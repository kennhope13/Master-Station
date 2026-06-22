import {VideoRTC} from './video-rtc.js';

/**
 * This is example, how you can extend VideoRTC player for your app.
 * Also you can check this example: https://github.com/AlexxIT/WebRTC
 */
class VideoStream extends VideoRTC {
    set divMode(value) {
        this.setAttribute('mode', value.toLowerCase());
        this.querySelector('.mode').innerText = value === 'loading' ? 'Đang kết nối' : value;
        this.querySelector('.status').innerText = value === 'loading' ? 'Đang tải luồng video...' : '';
    }

    set divError(value) {
        const state = this.getAttribute('mode');
        if (state !== 'loading') return;
        this.setAttribute('mode', 'error');
        this.querySelector('.mode').innerText = 'Lỗi kết nối';
        this.querySelector('.status').innerText = value;
    }

    /**
     * Custom GUI
     */
    oninit() {
        console.debug('stream.oninit');
        super.oninit();

        this.innerHTML = `
        <style>
        video-stream {
            position: relative;
            background: #090d16;
            font-family: system-ui, -apple-system, sans-serif;
            width: 100% !important;
            height: 100% !important;
            display: block;
        }
        .info {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 16px;
            color: #94a3b8;
            pointer-events: none;
            text-align: center;
            z-index: 10;
            background: rgba(8, 13, 22, 0.85);
            box-sizing: border-box;
            transition: all 0.2s ease;
        }
        /* Hide info when video is playing */
        video-stream[mode="rtc"] .info,
        video-stream[mode="mse"] .info,
        video-stream[mode="hls"] .info,
        video-stream[mode="mp4"] .info,
        video-stream[mode="mjpeg"] .info {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }
        .mode {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            padding: 4px 10px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 8px;
            border-radius: 0;
            color: #fff;
        }
        video-stream[mode="error"] .mode {
            background: rgba(239, 68, 68, 0.15);
            border-color: rgba(239, 68, 68, 0.4);
            color: #f87171;
        }
        video-stream[mode="loading"] .mode {
            background: rgba(245, 158, 11, 0.15);
            border-color: rgba(245, 158, 11, 0.4);
            color: #fbbf24;
            animation: stream-pulse 1.5s infinite;
        }
        .status {
            font-size: 10px;
            line-height: 1.4;
            max-width: 90%;
            word-break: break-word;
            color: #64748b;
        }
        video-stream[mode="error"] .status {
            color: #94a3b8;
        }
        @keyframes stream-pulse {
            0% { opacity: 0.6; }
            50% { opacity: 1; }
            100% { opacity: 0.6; }
        }
        </style>
        <div class="info">
            <div class="mode"></div>
            <div class="status"></div>
        </div>
        `;

        const info = this.querySelector('.info');
        this.insertBefore(this.video, info);
    }

    onconnect() {
        console.debug('stream.onconnect');
        const result = super.onconnect();
        if (result) this.divMode = 'loading';
        return result;
    }

    ondisconnect() {
        console.debug('stream.ondisconnect');
        super.ondisconnect();
    }

    onopen() {
        console.debug('stream.onopen');
        const result = super.onopen();

        this.onmessage['stream'] = msg => {
            console.debug('stream.onmessge', msg);
            switch (msg.type) {
                case 'error':
                    this.divError = msg.value;
                    break;
                case 'mse':
                case 'hls':
                case 'mp4':
                case 'mjpeg':
                    this.divMode = msg.type.toUpperCase();
                    break;
            }
        };

        return result;
    }

    onclose() {
        console.debug('stream.onclose');
        return super.onclose();
    }

    onpcvideo(ev) {
        console.debug('stream.onpcvideo');
        super.onpcvideo(ev);

        if (this.pcState !== WebSocket.CLOSED) {
            this.divMode = 'RTC';
        }
    }
}

customElements.define('video-stream', VideoStream);
