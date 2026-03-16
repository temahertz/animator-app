import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';

const SIZES = [1080, 1350, 1440, 1920, 2560];
const SPEEDS = [0.1, 0.5, 1];
const MAX_IMAGES = 20;

const getEdgeBrightness = (url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    const s = 32;
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, s, s);
    const d = ctx.getImageData(0, 0, s, s).data;
    let total = 0, count = 0;
    for (let i = 0; i < s; i++) {
      for (const [x, y] of [[i, 0], [i, s-1], [0, i], [s-1, i]]) {
        const p = (y * s + x) * 4;
        total += d[p] * 0.299 + d[p+1] * 0.587 + d[p+2] * 0.114;
        count++;
      }
    }
    resolve(total / count);
  };
  img.onerror = () => resolve(0);
  img.src = url;
});

const drawImageCover = (ctx, img, w, h) => {
  const scale = Math.max(w / img.width, h / img.height);
  const x = (w - img.width * scale) / 2;
  const y = (h - img.height * scale) / 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
};

const formatSpeed = (v) => v === 1 ? '1' : v.toFixed(1).replace('.', ',');

export default function App() {
  const [images, setImages] = useState([]);

  const [sizeRange, setSizeRange] = useState([0, 0]); // [0,0] = 1080×1080
  const [speed, setSpeed] = useState(0.2);
  const [exportFormat, setExportFormat] = useState('MP4');

  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [touchDraggedIndex, setTouchDraggedIndex] = useState(null);

  // 'size', 'format', 'speed', or null
  const [activeSetting, setActiveSetting] = useState(null);

  const fileInputRef = useRef(null);
  const timelineRef = useRef(null);
  const dualSliderRef = useRef(null);
  const speedSliderRef = useRef(null);
  const settingsRowRoRef = useRef(null);
  const [settingsRowWidth, setSettingsRowWidth] = useState(300);
  const settingsRowRef = (el) => {
    if (el && !settingsRowRoRef.current) {
      const ro = new ResizeObserver(([entry]) => setSettingsRowWidth(entry.contentRect.width));
      ro.observe(el);
      settingsRowRoRef.current = ro;
    }
  };

  const isSwiping = useRef(false);
  const hasDragged = useRef(false);

  const activeThumb = useRef(null);
  const [isSizeDragging, setIsSizeDragging] = useState(false);
  const isSizeDraggingRef = useRef(false);

  const touchStartCoords = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const dragCoords = useRef({ x: 0, y: 0 });
  const autoScroll = useRef({ speed: 0 });
  const touchDraggedIndexRef = useRef(null);
  const rafRef = useRef(null);
  const pressTimer = useRef(null);
  const ghostRef = useRef(null);
  const lastReorderTime = useRef(0);
  const cachedGap = useRef(5);
  const cachedContainerRect = useRef(null);

  const pendingDragIndex = useRef(null);
  const isTouchDev = useRef(false);
  const activateDragRef = useRef(null);
  const framePositionsRef = useRef(new Map());
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const isDragging = touchDraggedIndex !== null;

  const minIdx = Math.min(sizeRange[0], sizeRange[1]);
  const maxIdx = Math.max(sizeRange[0], sizeRange[1]);
  const currentWidth = SIZES[minIdx];
  const currentHeight = SIZES[maxIdx];

  useEffect(() => {
    const updateTheme = (e) => {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    updateTheme(mediaQuery);
    mediaQuery.addEventListener('change', updateTheme);
    return () => mediaQuery.removeEventListener('change', updateTheme);
  }, []);


  activateDragRef.current = (index) => {
    // Recalculate offset so ghost appears at original thumbnail position
    touchStartCoords.current.offsetX = dragCoords.current.x - touchStartCoords.current.targetLeft;
    touchStartCoords.current.offsetY = dragCoords.current.y - touchStartCoords.current.targetTop;
    if (ghostRef.current) {
      const x = touchStartCoords.current.targetLeft;
      const y = touchStartCoords.current.targetTop;
      ghostRef.current.style.transform = `translate(${x}px, ${y}px) scale(1.08)`;
    }
    // Cache gap & rect for drag performance (avoid getComputedStyle/getBoundingClientRect per move)
    if (timelineRef.current) {
      cachedGap.current = parseFloat(getComputedStyle(timelineRef.current).gap) || 5;
      cachedContainerRect.current = timelineRef.current.getBoundingClientRect();
    }
    setTouchDraggedIndex(index);
    touchDraggedIndexRef.current = index;
    if (window.navigator?.vibrate && isTouchDev.current) window.navigator.vibrate(50);
    startAutoScrollLoop();
    pendingDragIndex.current = null;
  };

  useEffect(() => {
    let interval;
    if (isPlaying && images.length > 0) {
      interval = setInterval(() => {
        setCurrentFrame((prev) => (prev + 1) % images.length);
      }, speed * 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, images.length, speed]);

  useEffect(() => {
    if (currentFrame >= images.length) {
      setCurrentFrame(Math.max(0, images.length - 1));
    }
    if (images.length === 0) {
      setIsPlaying(false);
      setActiveSetting(null);
    }
  }, [images.length, currentFrame]);

  // Auto-scroll timeline to keep active frame visible
  useEffect(() => {
    if (!timelineRef.current || images.length === 0 || isDragging) return;
    const container = timelineRef.current;
    const frameEl = container.children[currentFrame];
    if (!frameEl) return;
    const cRect = container.getBoundingClientRect();
    const fRect = frameEl.getBoundingClientRect();
    const visibleLeft = cRect.left + 11;
    const visibleRight = cRect.right - 11;
    if (fRect.right > visibleRight) {
      // Going forward — current frame at left edge of new page
      const targetScroll = Math.round(frameEl.offsetLeft - 11);
      container.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    } else if (fRect.left < visibleLeft) {
      // Going backward — current frame at right edge of new page
      const targetScroll = Math.round(frameEl.offsetLeft + frameEl.offsetWidth + 11 - container.clientWidth);
      container.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [currentFrame, images.length, isDragging]);

  const isAnyDragging = isDragging || isSizeDragging;
  useEffect(() => {
    if (isAnyDragging) document.body.classList.add('global-dragging');
    else document.body.classList.remove('global-dragging');
    return () => document.body.classList.remove('global-dragging');
  }, [isAnyDragging]);

  const handleFiles = async (files) => {
    const validFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    const slotsAvailable = MAX_IMAGES - images.length;
    const filesToAdd = validFiles.slice(0, slotsAvailable);
    if (filesToAdd.length < validFiles.length) {
      alert(`LIMIT REACHED: ${MAX_IMAGES} FRAMES MAX.`);
    }
    const newImages = await Promise.all(filesToAdd.map(async (file) => {
      const url = URL.createObjectURL(file);
      const brightness = await getEdgeBrightness(url);
      return {
        id: Math.random().toString(36).substr(2, 9),
        url,
        file,
        lightEdges: brightness > 240
      };
    }));
    setImages(prev => [...prev, ...newImages]);
  };

  const onDropZone = (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const removeImage = (indexToRemove) => {
    setImages(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  // --- DUAL SLIDER (SIZE) ---
  // Click on a size pill — snap to position, enable drag for that thumb
  const handleSizePointerDown = (e, indexClicked) => {
    e.preventDefault();
    e.stopPropagation();
    setSizeRange(prev => {
      const next = [...prev];
      if (prev[0] === prev[1]) {
        next[1] = indexClicked;
        activeThumb.current = 1;
      } else if (indexClicked === prev[0]) {
        activeThumb.current = 0;
      } else if (indexClicked === prev[1]) {
        activeThumb.current = 1;
      } else {
        const dist0 = Math.abs(indexClicked - prev[0]);
        const dist1 = Math.abs(indexClicked - prev[1]);
        if (dist0 < dist1) {
          next[0] = indexClicked;
          activeThumb.current = 0;
        } else {
          next[1] = indexClicked;
          activeThumb.current = 1;
        }
      }
      return next;
    });
  };


  // --- SPEED SLIDER (continuous 0.1-1.0 with 0.1 snap) ---
  const speedDragging = useRef(false);
  const [isSpeedDragging, setIsSpeedDragging] = useState(false);

  const computeSpeedFromPointer = (e) => {
    if (!speedSliderRef.current) return null;
    const rect = speedSliderRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
    const maxLeft = rect.width - 57; // width - thumb(55) - 2px padding
    const midLeft = 2 + (maxLeft - 2) / 2;
    const halfRange = (maxLeft - 2) / 2;
    const thumbLeft = Math.max(2, Math.min(clientX - rect.left - 27.5, maxLeft));
    let raw;
    if (thumbLeft <= midLeft) {
      raw = 0.1 + ((thumbLeft - 2) / halfRange) * 0.4;
    } else {
      raw = 0.5 + ((thumbLeft - midLeft) / halfRange) * 0.5;
    }
    return Math.max(0.1, Math.min(1, Math.round(raw * 10) / 10));
  };

  const handleSpeedPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    speedDragging.current = true;
    // Don't set isSpeedDragging yet — only on first move (so clicks animate smoothly)
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = computeSpeedFromPointer(e);
    if (v !== null) setSpeed(v);
  };

  const handleSpeedPointerMove = (e) => {
    if (!speedDragging.current) return;
    if (!isSpeedDragging) setIsSpeedDragging(true);
    const v = computeSpeedFromPointer(e);
    if (v !== null) setSpeed(v);
  };

  const handleSpeedPointerUp = (e) => {
    speedDragging.current = false;
    setIsSpeedDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  // --- FLIP animation for smooth reordering ---
  const captureFramePositions = () => {
    const container = timelineRef.current;
    if (!container) return;
    const items = container.querySelectorAll('.frame-item');
    items.forEach(el => {
      const id = el.dataset.id;
      if (id) framePositionsRef.current.set(id, el.getBoundingClientRect().left);
    });
  };

  useLayoutEffect(() => {
    if (framePositionsRef.current.size === 0) return;
    const container = timelineRef.current;
    if (!container) return;
    const draggedId = touchDraggedIndexRef.current !== null
      ? imagesRef.current[touchDraggedIndexRef.current]?.id
      : null;
    const items = container.querySelectorAll('.frame-item');
    items.forEach(el => {
      const id = el.dataset.id;
      if (!id || id === draggedId) return;
      const prevLeft = framePositionsRef.current.get(id);
      if (prevLeft === undefined) return;
      const currLeft = el.getBoundingClientRect().left;
      const dx = prevLeft - currLeft;
      if (Math.abs(dx) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)';
          el.style.transform = '';
        });
      });
    });
    framePositionsRef.current = new Map();
  }, [images]);

  // --- DRAG AND DROP FRAMES ---
  const checkReorder = (x, y, currentIndex) => {
    const now = Date.now();
    if (now - lastReorderTime.current < 200) return currentIndex;
    const container = timelineRef.current;
    if (!container) return currentIndex;
    const rect = cachedContainerRect.current || container.getBoundingClientRect();
    if (y < rect.top - 30 || y > rect.bottom + 30) return currentIndex;
    const ghostCenterX = x - touchStartCoords.current.offsetX + 27.5;
    const relativeX = ghostCenterX - rect.left + container.scrollLeft - 11;
    const gap = cachedGap.current;
    const itemStep = 55 + gap;
    const targetIndex = Math.max(0, Math.min(
      Math.round((relativeX - 27.5) / itemStep),
      imagesRef.current.length - 1
    ));
    if (targetIndex === currentIndex) return currentIndex;
    captureFramePositions();
    setImages(prev => {
      const newImages = [...prev];
      const [movedItem] = newImages.splice(currentIndex, 1);
      newImages.splice(targetIndex, 0, movedItem);
      return newImages;
    });
    lastReorderTime.current = now;
    return targetIndex;
  };

  const startAutoScrollLoop = () => {
    if (rafRef.current) return;
    const loop = () => {
      if (touchDraggedIndexRef.current !== null && timelineRef.current) {
        if (autoScroll.current.speed !== 0) {
          timelineRef.current.scrollLeft += autoScroll.current.speed;
          const newIndex = checkReorder(dragCoords.current.x, dragCoords.current.y, touchDraggedIndexRef.current);
          if (newIndex !== touchDraggedIndexRef.current) {
            setTouchDraggedIndex(newIndex);
            touchDraggedIndexRef.current = newIndex;
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const handlePointerDown = (e, index) => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    const isTouch = !!e.touches;
    isTouchDev.current = isTouch;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    const targetRect = e.currentTarget.getBoundingClientRect();
    touchStartCoords.current = { x: clientX, y: clientY, offsetX: clientX - targetRect.left, offsetY: clientY - targetRect.top, targetLeft: targetRect.left, targetTop: targetRect.top };
    dragCoords.current = { x: clientX, y: clientY };
    isSwiping.current = false;
    hasDragged.current = false;
    pendingDragIndex.current = index;
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      if (pendingDragIndex.current !== null && activateDragRef.current) {
        activateDragRef.current(pendingDragIndex.current);
      }
    }, isTouch ? 350 : 200);
  };

  // --- UNIFIED GLOBAL HANDLER (frames + size slider only; speed uses pointer capture) ---
  useEffect(() => {
    const handleGlobalMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      dragCoords.current = { x: clientX, y: clientY };

      // 1. DRAG TIMELINE FRAMES
      if (touchDraggedIndexRef.current !== null) {
        if (e.cancelable) e.preventDefault();
        hasDragged.current = true;
        if (ghostRef.current) {
          const x = clientX - touchStartCoords.current.offsetX;
          const y = clientY - touchStartCoords.current.offsetY;
          ghostRef.current.style.transform = `translate(${x}px, ${y}px) scale(1.08)`;
        }
        if (timelineRef.current) {
          const rect = cachedContainerRect.current || timelineRef.current.getBoundingClientRect();
          const EDGE = 45;
          const maxScroll = timelineRef.current.scrollWidth - timelineRef.current.clientWidth;
          if (clientX < rect.left + EDGE && timelineRef.current.scrollLeft > 0) autoScroll.current.speed = -7;
          else if (clientX > rect.right - EDGE && timelineRef.current.scrollLeft < maxScroll) autoScroll.current.speed = 7;
          else autoScroll.current.speed = 0;
        }
        const newIndex = checkReorder(clientX, clientY, touchDraggedIndexRef.current);
        if (newIndex !== touchDraggedIndexRef.current) {
          setTouchDraggedIndex(newIndex);
          touchDraggedIndexRef.current = newIndex;
        }
      }
      // 2. DRAG SIZE SLIDER
      else if (activeThumb.current === 0 || activeThumb.current === 1) {
        if (!isSizeDraggingRef.current) { isSizeDraggingRef.current = true; setIsSizeDragging(true); }
        if (e.cancelable) e.preventDefault();
        if (!dualSliderRef.current) return;
        const rect = dualSliderRef.current.getBoundingClientRect();
        const maxLeft = rect.width - 55;
        const x = Math.max(0, Math.min(clientX - rect.left - 27.5, maxLeft));
        const percent = x / maxLeft;
        const idx = Math.round(percent * (SIZES.length - 1));
        setSizeRange(prev => {
          const next = [...prev];
          if (next[activeThumb.current] !== idx) {
            next[activeThumb.current] = idx;
            return next;
          }
          return prev;
        });
      }
      // 3. SWIPE DETECTION FOR FRAMES
      else if (pendingDragIndex.current !== null) {
        const dx = Math.abs(clientX - touchStartCoords.current.x);
        const dy = Math.abs(clientY - touchStartCoords.current.y);
        if (dx > 5 || dy > 5) {
          if (isTouchDev.current) {
            clearTimeout(pressTimer.current);
            pendingDragIndex.current = null;
            isSwiping.current = true;
          } else {
            clearTimeout(pressTimer.current);
            if (activateDragRef.current && pendingDragIndex.current !== null) {
              activateDragRef.current(pendingDragIndex.current);
            }
            pendingDragIndex.current = null;
          }
        }
      }
    };

    const handleGlobalUp = () => {
      activeThumb.current = null;
      if (isSizeDraggingRef.current) { isSizeDraggingRef.current = false; setIsSizeDragging(false); }
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (pendingDragIndex.current !== null) pendingDragIndex.current = null;
      if (touchDraggedIndexRef.current !== null) {
        setCurrentFrame(touchDraggedIndexRef.current);
        setIsPlaying(false);
        setTouchDraggedIndex(null);
        touchDraggedIndexRef.current = null;
        hasDragged.current = true;
        autoScroll.current.speed = 0;
        cachedContainerRect.current = null;
      }
    };

    window.addEventListener('pointermove', handleGlobalMove, { passive: false });
    window.addEventListener('pointerup', handleGlobalUp);
    window.addEventListener('pointercancel', handleGlobalUp);
    window.addEventListener('touchmove', handleGlobalMove, { passive: false });
    window.addEventListener('touchend', handleGlobalUp);
    window.addEventListener('touchcancel', handleGlobalUp);
    return () => {
      window.removeEventListener('pointermove', handleGlobalMove);
      window.removeEventListener('pointerup', handleGlobalUp);
      window.removeEventListener('pointercancel', handleGlobalUp);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('touchend', handleGlobalUp);
      window.removeEventListener('touchcancel', handleGlobalUp);
    };
  }, []);

  const exportVideo = async () => {
    if (images.length === 0) return;
    setIsExporting(true);
    setIsPlaying(false);
    setActiveSetting(null);

    const canvas = document.createElement('canvas');
    canvas.width = currentWidth;
    canvas.height = currentHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.opacity = '0.01';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-9999';
    document.body.appendChild(canvas);

    try {
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const loadedImages = await Promise.all(images.map(imgData => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = imgData.url;
        });
      }));

      if (exportFormat.toLowerCase() === 'gif') {
        if (!window.gifshot) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/gifshot/0.3.2/gifshot.min.js';
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
          });
        }
        const frames = loadedImages.map(img => {
          drawImageCover(ctx, img, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', 1.0);
        });
        window.gifshot.createGIF({
          images: frames,
          interval: speed,
          gifWidth: canvas.width,
          gifHeight: canvas.height,
          sampleInterval: 2,
          numWorkers: navigator.hardwareConcurrency || 2
        }, (obj) => {
          setIsExporting(false);
          if (document.body.contains(canvas)) document.body.removeChild(canvas);
          if (!obj.error) {
            const a = document.createElement('a');
            a.href = obj.image;
            a.download = `frame-to-frame-${Date.now()}.gif`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } else {
            alert("Export Failed.");
          }
        });
        return;
      }

      const stream = canvas.captureStream(30);
      let mimeType = '';
      if (exportFormat.toLowerCase() === 'mp4') {
        if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
        else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) mimeType = 'video/webm;codecs=h264';
        else mimeType = 'video/webm';
      } else {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
        else mimeType = 'video/webm';
      }

      const dummyRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1000000 });
      dummyRecorder.start();
      const requestFrame = () => {
        const track = stream.getVideoTracks()[0];
        if (track?.requestFrame) track.requestFrame();
      };
      for (let w = 0; w < 3; w++) {
        if (loadedImages.length > 0) drawImageCover(ctx, loadedImages[0], canvas.width, canvas.height);
        requestFrame();
        await new Promise(r => setTimeout(r, 50));
      }
      dummyRecorder.stop();
      await new Promise(r => setTimeout(r, 200));

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 50000000 });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        let extension = exportFormat.toLowerCase();
        if (mimeType.includes('webm')) extension = 'webm';
        if (mimeType.includes('mp4')) extension = 'mp4';
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `frame-to-frame-${Date.now()}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setIsExporting(false);
        if (document.body.contains(canvas)) document.body.removeChild(canvas);
      };

      recorder.start();
      for (let i = 0; i < loadedImages.length; i++) {
        drawImageCover(ctx, loadedImages[i], canvas.width, canvas.height);
        requestFrame();
        await new Promise(r => setTimeout(r, speed * 1000));
      }
      await new Promise(r => setTimeout(r, 200));
      recorder.stop();
    } catch (error) {
      console.error(error);
      setIsExporting(false);
      if (document.body.contains(canvas)) document.body.removeChild(canvas);
    }
  };

  const getEstimatedSize = () => {
    if (images.length === 0) return '0.0 MB';
    const pixelCount = currentWidth * currentHeight;
    const durationSec = images.length * speed;
    let bitsPerPixelPerSec = 0.55;
    if (exportFormat.toLowerCase() === 'webm') bitsPerPixelPerSec = 0.45;
    if (exportFormat.toLowerCase() === 'gif') bitsPerPixelPerSec = 1.0;
    const sizeMB = (pixelCount * bitsPerPixelPerSec * durationSec) / (8 * 1024 * 1024);
    return `${sizeMB < 0.1 ? '< 0.1' : sizeMB.toFixed(1)} MB`;
  };

  const nextFrame = (e) => {
    if (e) e.preventDefault();
    if (images.length === 0) return;
    setIsPlaying(false);
    setCurrentFrame(prev => (prev + 1) % images.length);
  };

  const prevFrame = (e) => {
    if (e) e.preventDefault();
    if (images.length === 0) return;
    setIsPlaying(false);
    setCurrentFrame(prev => (prev - 1 + images.length) % images.length);
  };

  const toggleSetting = (name) => {
    setActiveSetting(prev => prev === name ? null : name);
  };

  // Speed slider geometry — piecewise linear: 0.1→left, 0.5→center, 1→right
  const speedSegment = (settingsRowWidth - 59) / 2;
  const speedToLeft = (v) => {
    if (v <= 0.5) return 2 + ((v - 0.1) / 0.4) * speedSegment;
    return 2 + speedSegment + ((v - 0.5) / 0.5) * speedSegment;
  };
  const speedThumbLeft = speedToLeft(speed);
  const speedFillWidth = speedThumbLeft + 57; // thumb(55) + 2px right padding

  // Size slider geometry
  const sizeStep = (settingsRowWidth - 59) / (SIZES.length - 1);
  const sizeBarLeft = minIdx * sizeStep;
  const sizeBarWidth = (maxIdx - minIdx) * sizeStep + 59;

  // Timeline gap: align last visible thumbnail with 3rd settings circle
  // 7 thumbs on wide desktop, 6 on medium, 5 on narrow/mobile
  const timelineGap = settingsRowWidth >= 417
    ? Math.max(5, (settingsRowWidth - 387) / 6)
    : settingsRowWidth >= 357
      ? Math.max(5, (settingsRowWidth - 332) / 5)
      : Math.max(5, (settingsRowWidth - 277) / 4);

  const ghostX = dragCoords.current.x - touchStartCoords.current.offsetX;
  const ghostY = dragCoords.current.y - touchStartCoords.current.offsetY;

  return (
    <div className="h-[100dvh] w-full font-mono text-black dark:text-white flex flex-col items-center justify-between py-[15px] relative overflow-hidden selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black bg-white dark:bg-black">

      {/* Grid background + radial gradient fade */}
      <div
        className="absolute inset-0 pointer-events-none z-0 dark:opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px',
          backgroundPosition: 'center center',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none z-0 dark:hidden"
        style={{
          background: 'radial-gradient(ellipse at 50% 25%, transparent 0%, white 70%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none z-0 hidden dark:block"
        style={{
          background: 'radial-gradient(ellipse at 50% 25%, transparent 0%, black 70%)',
        }}
      />

      <input
        type="file" multiple accept="image/*" className="hidden"
        ref={fileInputRef} onChange={(e) => { handleFiles(e.target.files); e.target.value = null; }}
      />

      {/* Header */}
      <div className="relative z-10 w-full flex justify-between items-start px-[20px] shrink-0">
        <span className="text-[9px] leading-[1.2] uppercase">frame to frame</span>
        <span className="text-[9px] leading-[1.2] text-right">v.11.0 (beta)</span>
      </div>

      {/* Zero State */}
      {images.length === 0 && (
        <div
          className="relative z-10 flex flex-col items-center justify-center flex-1"
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={onDropZone}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            className="group flex flex-col items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95"
          >
            <div className={`w-20 h-20 rounded-full bg-[#f4f4f4] dark:bg-[#1C1C1E] flex items-center justify-center mb-6 transition-all duration-300 ${isDraggingOver ? 'scale-110 bg-[#e8e8e8]' : ''}`}>
              <span className="text-4xl font-light leading-none text-black/40 dark:text-white/40 mb-1 pointer-events-none">+</span>
            </div>
            <h3 className="text-[9px] tracking-widest uppercase mb-1 text-black/60 dark:text-white/60">START PROJECT</h3>
            <span className="text-[9px] tracking-widest uppercase text-black/30 dark:text-white/30">Drag & Drop frames</span>
          </button>
        </div>
      )}

      {/* Body — Workspace */}
      {images.length > 0 && (
        <div
          className="flex flex-col gap-[15px] items-center justify-center relative z-10 shrink-0 w-full"
          style={{ '--ew': 'clamp(280px, min(calc(100vw - 40px), calc(100dvh - 440px)), 500px)' }}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={onDropZone}
        >
          {/* Drag overlay */}
          {isDraggingOver && (
            <div className="absolute inset-0 bg-white/90 dark:bg-black/90 backdrop-blur-md z-50 flex flex-col items-center justify-center pointer-events-none rounded-[24px]">
              <span className="text-4xl font-light text-black/40 dark:text-white/40 mb-3">+</span>
              <span className="text-[9px] tracking-widest uppercase">DROP FRAMES</span>
            </div>
          )}

          {/* Preview Area */}
          <div className="w-full flex flex-col items-center justify-center px-[20px]">
            <div className="w-full flex items-center justify-center relative z-[2]" style={{ maxWidth: 'var(--ew)', height: 'var(--ew)' }}>
              <div
                className="rounded-[14px] overflow-hidden relative transition-all duration-300 ease-out"
                style={{
                  aspectRatio: `${currentWidth} / ${currentHeight}`,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: currentWidth >= currentHeight ? '100%' : 'auto',
                  height: currentWidth <= currentHeight ? '100%' : 'auto',
                }}
              >
                <img
                  src={images[currentFrame]?.url}
                  alt="Frame"
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                />
                {images[currentFrame]?.lightEdges && (
                  <div className="absolute inset-0 rounded-[14px] pointer-events-none z-10" style={{ boxShadow: 'inset 0 0 0 1px #C8C8C8' }} />
                )}
              </div>
            </div>
          </div>

          {/* Player */}
          <div className="flex items-center justify-between px-[12px]" style={{ width: 'var(--ew)' }}>
            {/* Frame counter circle */}
            <div className="w-[55px] h-[55px] rounded-full flex flex-col items-center justify-center shrink-0">
              <span className="text-[9px] leading-[1.2] uppercase">
                {currentFrame + 1}/{images.length}
              </span>
            </div>

            {/* Player Controls */}
            <div className="flex gap-[12px] items-center shrink-0">
              {/* Back */}
              <button type="button" onPointerDown={prevFrame} className="w-[30px] h-[30px] flex items-center justify-center text-black dark:text-white active:scale-75 transition-transform p-[10px]">
                <svg width="10" height="9" viewBox="0 0 10 9" fill="none">
                  <path d="M2 4.5L10 9V0L2 4.5Z" fill="currentColor"/>
                  <path d="M2 0H0V9H2V0Z" fill="currentColor"/>
                </svg>
              </button>

              {/* Play/Pause */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); setIsPlaying(!isPlaying); }}
                className="w-[55px] h-[55px] bg-black dark:bg-white text-white dark:text-black rounded-[27.5px] flex items-center justify-center transition-colors shrink-0"
              >
                {isPlaying ? (
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="currentColor">
                    <rect x="3" y="1" width="4.5" height="17" rx="1"/>
                    <rect x="11.5" y="1" width="4.5" height="17" rx="1"/>
                  </svg>
                ) : (
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="currentColor" className="ml-[2px]">
                    <path d="M3 1.5L17 9.5L3 17.5V1.5Z"/>
                  </svg>
                )}
              </button>

              {/* Forward */}
              <button type="button" onPointerDown={nextFrame} className="w-[30px] h-[30px] flex items-center justify-center text-black dark:text-white active:scale-75 transition-transform p-[10px]">
                <svg width="10" height="9" viewBox="0 0 10 9" fill="none">
                  <path d="M8 4.5L0 9V0L8 4.5Z" fill="currentColor"/>
                  <path d="M8 0H10V9H8V0Z" fill="currentColor"/>
                </svg>
              </button>
            </div>

            {/* Empty spacer circle for symmetry */}
            <div className="w-[55px] h-[55px] shrink-0" />
          </div>

          {/* Frames Timeline */}
          <div className="relative overflow-hidden" style={{ width: 'var(--ew)' }}>
            <div
              ref={timelineRef}
              className={`flex items-center overflow-x-auto hide-scrollbar px-[11px] ${isDragging ? 'touch-none' : ''}`}
              style={{ gap: `${timelineGap}px`, maskImage: 'linear-gradient(90deg, transparent 0%, transparent 7px, black 11px, black calc(100% - 11px), transparent calc(100% - 7px), transparent 100%)', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, transparent 7px, black 11px, black calc(100% - 11px), transparent calc(100% - 7px), transparent 100%)' }}
            >
              {images.map((img, index) => (
                <div
                  key={img.id}
                  data-index={index}
                  data-id={img.id}
                  className={`frame-item select-none [-webkit-touch-callout:none] relative group flex-shrink-0 w-[55px] h-[75px] cursor-grab active:cursor-grabbing rounded-[14px] ${touchDraggedIndex === index ? 'opacity-20' : ''}`}
                  style={isDragging ? { willChange: 'transform' } : undefined}
                  onMouseDown={(e) => handlePointerDown(e, index)}
                  onTouchStart={(e) => handlePointerDown(e, index)}
                  onClick={(e) => {
                    if (isSwiping.current || hasDragged.current) { e.preventDefault(); e.stopPropagation(); return; }
                    setCurrentFrame(index); setIsPlaying(false);
                  }}
                >
                  <img src={img.url} alt="Thumb" className="absolute inset-0 w-full h-full object-cover pointer-events-none rounded-[14px] bg-[#f4f4f4] dark:bg-[#1C1C1E]" />
                  <div className="absolute inset-0 rounded-[14px] pointer-events-none z-10" style={{ boxShadow: currentFrame === index ? 'inset 0 0 0 2px #000' : img.lightEdges ? 'inset 0 0 0 1px #C8C8C8' : 'none' }} />
                  {currentFrame === index && (
                    <button
                      type="button" onClick={(e) => { e.stopPropagation(); removeImage(index); }}
                      className="absolute top-[5px] right-[5px] w-[20px] h-[20px] bg-black text-white rounded-full flex items-center justify-center z-20"
                    >
                      <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
                        <path d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5" stroke="white" strokeWidth="1" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}

              {images.length < MAX_IMAGES && (
                <button
                  type="button" onClick={() => fileInputRef.current?.click()}
                  className="group flex-shrink-0 w-[55px] h-[75px] rounded-[14px] bg-[#f4f4f4] dark:bg-[#1C1C1E] flex flex-col items-center justify-center gap-[5px] py-[19px] transition-colors duration-200"
                >
                  <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center group-hover:bg-white dark:group-hover:bg-black transition-colors duration-200">
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M4 0.5V7.5M0.5 4H7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="text-[#828282] group-hover:text-black dark:group-hover:text-white transition-colors duration-200" />
                    </svg>
                  </div>
                  <span className="text-[9px] leading-[1.2] uppercase text-[#828282] group-hover:text-black dark:group-hover:text-white transition-colors duration-200">ADD</span>
                </button>
              )}
            </div>

          </div>

          {/* Settings Container */}
          <div className="h-[170px] bg-[#f4f4f4] dark:bg-[#1C1C1E] rounded-[32px] pt-[8px] pb-[10px] px-[10px] flex flex-col items-center justify-between shrink-0" style={{ width: 'var(--ew)' }}>

            {/* Settings Row */}
            <div ref={settingsRowRef} className="relative w-full h-[59px] flex items-center justify-between">

              {/* Default state: 3 white circles */}
              {activeSetting === null && (
                <div className="w-full h-full flex items-center justify-between px-[2px]">
                  <button onClick={() => toggleSetting('size')} className="w-[55px] h-[55px] rounded-full flex items-center justify-center bg-white dark:bg-[#2A2A2C] transition-colors">
                    <span className="text-[9px] leading-[1.2] uppercase">{currentHeight}</span>
                  </button>
                  <button onClick={() => toggleSetting('format')} className="w-[55px] h-[55px] rounded-full flex items-center justify-center bg-white dark:bg-[#2A2A2C] transition-colors">
                    <span className="text-[9px] leading-[1.2] uppercase">{exportFormat}</span>
                  </button>
                  <button onClick={() => toggleSetting('speed')} className="w-[55px] h-[55px] rounded-full flex items-center justify-center bg-white dark:bg-[#2A2A2C] transition-colors">
                    <span className="text-[9px] leading-[1.2] lowercase">{formatSpeed(speed)} sec</span>
                  </button>
                </div>
              )}

              {/* SIZE expanded */}
              {activeSetting === 'size' && (() => {
                const sizeTransition = isSizeDragging ? 'none' : 'left 300ms cubic-bezier(0.16, 1, 0.3, 1), width 300ms cubic-bezier(0.16, 1, 0.3, 1)';
                const thumbTransition = isSizeDragging ? 'none' : 'left 300ms cubic-bezier(0.16, 1, 0.3, 1)';
                const leftThumbLeft = 2 + minIdx * sizeStep;
                const rightThumbLeft = 2 + maxIdx * sizeStep;
                return (
                <div className={`w-full h-[59px] relative bg-[#f4f4f4] dark:bg-[#1C1C1E] rounded-[30px] touch-none select-none ${isSizeDragging ? 'cursor-grabbing' : ''}`} ref={dualSliderRef}>
                  {/* Black range bar — animates smoothly */}
                  <div
                    className="absolute h-[59px] bg-black dark:bg-white rounded-[30px] pointer-events-none"
                    style={{ left: `${sizeBarLeft}px`, width: `${sizeBarWidth}px`, transition: sizeTransition }}
                  />
                  {/* Circle anchors — bottom layer, no dashed borders */}
                  {SIZES.map((s, i) => {
                    const left = 2 + i * sizeStep;
                    const isOnBlack = i > minIdx && i < maxIdx;
                    return (
                      <div
                        key={s}
                        className="group/anchor absolute top-0 w-[55px] h-[59px] flex items-center justify-center z-[1] cursor-pointer"
                        style={{ left: `${left}px` }}
                        onPointerDown={(e) => handleSizePointerDown(e, i)}
                      >
                        <span className={`text-[9px] leading-[1.2] uppercase text-[#828282] transition-colors duration-200 ${isOnBlack ? 'group-hover/anchor:text-white dark:group-hover/anchor:text-black' : 'group-hover/anchor:text-black dark:group-hover/anchor:text-white'}`}>{s}</span>
                      </div>
                    );
                  })}
                  {/* Left white thumb — slides smoothly */}
                  <div
                    className={`absolute top-[2px] w-[55px] h-[55px] bg-white dark:bg-black rounded-full flex items-center justify-center z-10 ${isSizeDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    style={{ left: `${leftThumbLeft}px`, filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.09))', transition: thumbTransition }}
                    onPointerDown={(e) => handleSizePointerDown(e, minIdx)}
                  >
                    <span className="text-[9px] leading-[1.2] uppercase text-black dark:text-white">{SIZES[minIdx]}</span>
                  </div>
                  {/* Right white thumb — always rendered, overlaps left when collapsed */}
                  <div
                    className={`absolute top-[2px] w-[55px] h-[55px] bg-white dark:bg-black rounded-full flex items-center justify-center z-10 ${isSizeDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    style={{ left: `${rightThumbLeft}px`, filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.09))', transition: thumbTransition }}
                    onPointerDown={(e) => handleSizePointerDown(e, maxIdx)}
                  >
                    <span className="text-[9px] leading-[1.2] uppercase text-black dark:text-white">{SIZES[maxIdx]}</span>
                  </div>
                  {/* Inset shadow overlay */}
                  <div className="absolute inset-0 pointer-events-none rounded-[30px] shadow-[inset_0px_1px_4px_0px_rgba(0,0,0,0.25)]" />
                </div>
                );
              })()}

              {/* FORMAT expanded */}
              {activeSetting === 'format' && (() => {
                const formats = ['WEBM', 'MP4', 'GIF'];
                const selectedIdx = formats.indexOf(exportFormat);
                const pillWidth = (settingsRowWidth - 4) / 3;
                const pillLeft = 2 + selectedIdx * pillWidth;
                return (
                  <div className="w-full h-[59px] relative flex items-center justify-between px-[2px] bg-[#f4f4f4] dark:bg-[#1C1C1E] rounded-[30px]">
                    {/* Sliding white pill indicator */}
                    <div
                      className="absolute top-[2px] h-[55px] rounded-[27.5px] bg-white dark:bg-black shadow-[0px_1px_2px_0px_rgba(0,0,0,0.09)] z-0"
                      style={{ left: `${pillLeft}px`, width: `${pillWidth}px`, transition: 'left 200ms ease-out' }}
                    />
                    {/* Format options */}
                    {formats.map((f) => (
                      <button
                        key={f}
                        onClick={() => setExportFormat(f)}
                        className={`flex-1 h-[55px] rounded-[27.5px] flex items-center justify-center relative z-10 cursor-pointer
                          ${exportFormat === f
                            ? 'text-black dark:text-white'
                            : 'text-[#828282] hover:text-black dark:hover:text-white transition-colors duration-200'}`}
                      >
                        <span className="text-[9px] leading-[1.2] uppercase">{f}</span>
                      </button>
                    ))}
                    {/* Inset shadow overlay */}
                    <div className="absolute inset-0 pointer-events-none rounded-[30px] shadow-[inset_0px_1px_4px_0px_rgba(0,0,0,0.25)]" />
                  </div>
                );
              })()}

              {/* SPEED expanded — continuous slider with anchor labels */}
              {activeSetting === 'speed' && (
                <div
                  className={`w-full h-[59px] relative bg-[#f4f4f4] dark:bg-[#1C1C1E] rounded-[30px] touch-none select-none ${isSpeedDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
                  ref={speedSliderRef}
                  onPointerDown={handleSpeedPointerDown}
                  onPointerMove={handleSpeedPointerMove}
                  onPointerUp={handleSpeedPointerUp}
                  onPointerCancel={handleSpeedPointerUp}
                >
                  {/* Black fill — from left edge to thumb right + 2px */}
                  <div
                    className="absolute h-[59px] left-0 top-0 bg-black dark:bg-white rounded-[30px] pointer-events-none"
                    style={{ width: `${speedFillWidth}px`, transition: isSpeedDragging ? 'none' : 'width 300ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                  />
                  {/* Anchor labels at 0.1, 0.5, 1 positions */}
                  {SPEEDS.map((s) => {
                    const left = speedToLeft(s);
                    const isOnBlack = s < speed;
                    return (
                      <div
                        key={s}
                        className="group/speed absolute top-0 w-[55px] h-[59px] flex items-center justify-center z-[5]"
                        style={{ left: `${left}px` }}
                      >
                        <span className={`text-[9px] leading-[1.2] text-[#828282] uppercase transition-colors duration-200 ${isOnBlack ? 'group-hover/speed:text-white dark:group-hover/speed:text-black' : 'group-hover/speed:text-black dark:group-hover/speed:text-white'}`}>
                          {formatSpeed(s)}
                        </span>
                      </div>
                    );
                  })}
                  {/* White thumb — 2px inset from track top */}
                  <div
                    className={`absolute top-[2px] w-[55px] h-[55px] bg-white dark:bg-black rounded-full flex items-center justify-center z-10 ${isSpeedDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    style={{ left: `${speedThumbLeft}px`, filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.09))', transition: isSpeedDragging ? 'none' : 'left 300ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                  >
                    <span className="text-[9px] leading-[1.2] text-black dark:text-white uppercase">
                      {formatSpeed(speed)}
                    </span>
                  </div>
                  {/* Inset shadow overlay */}
                  <div className="absolute inset-0 pointer-events-none rounded-[30px] shadow-[inset_0px_1px_4px_0px_rgba(0,0,0,0.25)]" />
                </div>
              )}
            </div>

            {/* Export Container */}
            <div className="flex flex-col gap-[12px] items-center justify-end w-full">
              {/* Est. Size — always visible */}
              <div className="text-[9px] leading-[1.2] text-black dark:text-white text-center w-full uppercase">
                est. size: {getEstimatedSize()}
              </div>

              {/* Export button (full-width) or OK button (circle) */}
              <button
                type="button"
                onClick={() => activeSetting ? setActiveSetting(null) : exportVideo()}
                disabled={!activeSetting && (images.length === 0 || isExporting)}
                className={`h-[55px] text-[9px] leading-[1.2] uppercase flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
                  ${activeSetting
                    ? 'w-[55px] rounded-full bg-white dark:bg-[#121212] text-black dark:text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.09)]'
                    : images.length === 0 || isExporting
                      ? 'w-full rounded-[50px] bg-white/50 dark:bg-[#2A2A2C] text-black/30 dark:text-white/30 cursor-not-allowed'
                      : 'w-full rounded-[50px] bg-white dark:bg-[#121212] text-black dark:text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.09)]'}`}
              >
                {activeSetting ? 'OK' : isExporting ? <span className="animate-pulse">RENDERING...</span> : 'EXPORT'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="relative z-10 text-[9px] leading-[1.2] text-center text-[#828282] w-[214px] shrink-0 mt-[15px]">
        All image processing happens locally in your browser. We never upload, store, or see your files.
      </p>

      {/* Ghost / Drag Preview */}
      <div
        ref={ghostRef}
        className={`fixed top-0 left-0 w-[55px] h-[75px] cursor-grabbing rounded-[14px] z-[9999] pointer-events-none overflow-hidden origin-center ${
          isDragging ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          willChange: 'transform',
          transform: isDragging ? `translate(${ghostX}px, ${ghostY}px) scale(1.08)` : 'translate(-999px, -999px)',
          transition: 'none',
          boxShadow: '0 8px 28px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.12)',
        }}
      >
        {isDragging && images[touchDraggedIndex] && (
          <img src={images[touchDraggedIndex].url} className="absolute inset-0 w-full h-full object-cover" />
        )}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .animate-fade-in { animation: fadeIn 0.4s ease-in forwards; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .global-dragging, .global-dragging * { cursor: grabbing !important; }
      `}} />
    </div>
  );
}
