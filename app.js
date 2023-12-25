const { Observable, fromEvent, partition, combineLatest, zip } = rxjs
const { map, flatMap, take, skip } = rxjs.operators

const bufferStream = (filename) =>
  new Observable(async (subscriber) => {
    const ffmpeg = FFmpeg.createFFmpeg({
      corePath: "thirdparty/ffmpeg-core.js",
      log: false
    })

    const fileExists = (file) => ffmpeg.FS("readdir", "/").includes(file)
    const readFile = (file) => ffmpeg.FS("readFile", file)

    await ffmpeg.load()
    const sourceBuffer = await fetch(filename).then((r) => r.arrayBuffer())
    ffmpeg.FS(
      "writeFile",
      "input.mp4",
      new Uint8Array(sourceBuffer, 0, sourceBuffer.byteLength)
    )

    let index = 0

    ffmpeg
      .run(
        "-i",
        "input.mp4",
        "-g",
        "1",
        // MediaStream 编码
        "-segment_format_options",
        "movflags=frag_keyframe+empty_moov+default_base_moof",
        // 编码5秒的片段
        "-segment_time",
        "5",
        // 通过index写入文件
        "-f",
        "segment",
        "%d.mp4"
      )
      .then(() => {
        // send out the remaining files
        while (fileExists(`${index}.mp4`)) {
          subscriber.next(readFile(`${index}.mp4`))
          index++
        }
        subscriber.complete()
      })

    setInterval(() => {
      // 定期检查是否有已写入的文件
      if (fileExists(`${index + 1}.mp4`)) {
        subscriber.next(readFile(`${index}.mp4`))
        index++
      }
    }, 200)
  })

const mediaSource = new MediaSource()
videoPlayer.src = URL.createObjectURL(mediaSource)
videoPlayer.play()

const mediaSourceOpen = fromEvent(mediaSource, "sourceopen")

const bufferStreamReady = combineLatest(
  mediaSourceOpen,
  bufferStream("tests/big.avi")
).pipe(map(([, a]) => a))

const sourceBufferUpdateEnd = bufferStreamReady.pipe(
  take(1),
  map((buffer) => {
    // 使用mime类型创建缓冲区
    const mime = `video/mp4; codecs="${muxjs.mp4.probe
      .tracks(buffer)
      .map((t) => t.codec)
      .join(",")}"`
    const sourceBuf = mediaSource.addSourceBuffer(mime)

    // 添加buffer
    mediaSource.duration = 5
    sourceBuf.timestampOffset = 0
    sourceBuf.appendBuffer(buffer)

    // 创建新的事件流
    return fromEvent(sourceBuf, "updateend").pipe(map(() => sourceBuf))
  }),
  flatMap((value) => value)
)

zip(sourceBufferUpdateEnd, bufferStreamReady.pipe(skip(1)))
  .pipe(
    map(([sourceBuf, buffer]) => {
      mediaSource.duration += 1
      sourceBuf.timestampOffset += 5
      sourceBuf.appendBuffer(buffer.buffer)
    })
  )
  .subscribe()
