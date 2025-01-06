// Importamos las dependencias necesarias
// pipeline: Para cargar y utilizar el modelo Whisper
// MessageTypes: Define los tipos de mensajes utilizados para la comunicación con el hilo principal
import { pipeline } from "@xenova/transformers";
import { MessageTypes } from "./presets";

// Clase para gestionar la carga y el uso del modelo Whisper
class MyTranscriptionPipeline {
  static task = "automatic-speech-recognition"; // Especifica la tarea de reconocimiento de habla
  static model = "Xenova/whisper-tiny"; // Especifica el modelo Whisper a utilizar
  static instance = null; // Guarda la instancia única del modelo (patrón Singleton)

  // Método estático para obtener o inicializar la instancia del modelo
  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      // Carga el modelo si no está inicializado
      this.instance = await pipeline(this.task, this.model, { progress_callback });
    }
    return this.instance; // Devuelve la instancia cargada
  }
}

// Listener para manejar mensajes desde el hilo principal
self.addEventListener("message", async (event) => {
  const { type, audio } = event.data; // Extrae el tipo de mensaje y el audio adjunto

  if (type === MessageTypes.INFERENCE_REQUEST) {
    // Si el mensaje es una solicitud de inferencia, inicia el proceso de transcripción
    await transcribe(audio);
  }
});

// Función principal para procesar el audio y generar transcripciones
async function transcribe(audio) {
  sendLoadingMessage("Cargando"); // Envía un mensaje indicando que se está cargando el modelo

  let pipeline;

  try {
    // Obtiene la instancia del modelo y carga el progreso
    pipeline = await MyTranscriptionPipeline.getInstance(load_model_callback);
    console.log("Pipeline: ", pipeline);
  } catch (err) {
    console.log(err.message); // Maneja errores en caso de fallo al cargar el modelo
  }

  sendLoadingMessage("Éxito"); // Indica que la carga del modelo fue exitosa

  const stride_length_s = 5; // Define el solapamiento entre fragmentos de audio

  // Crea un objeto para gestionar el seguimiento del proceso de generación
  const generationTracker = new GenerationTracker(pipeline, stride_length_s);

  // Procesa el audio utilizando el modelo con los parámetros configurados
  await pipeline(audio, {
    top_k: 0, // No usa muestreo estocástico, elige los mejores resultados
    do_sample: false, // Desactiva el muestreo aleatorio
    chunk_length: 30, // Longitud de cada fragmento en segundos
    stride_length_s, // Solapamiento entre fragmentos
    return_timestamps: true, // Solicita marcas de tiempo en la transcripción
    callback_function:
      generationTracker.callbackFunction.bind(generationTracker), // Función de callback para resultados parciales
    chunk_callback: generationTracker.chunkCallback.bind(generationTracker), // Función de callback para procesar fragmentos
  });

  generationTracker.sendFinalResult(); // Envía el resultado final al hilo principal
}

// Callback para manejar el progreso de la carga del modelo
async function load_model_callback(data) {
  const { status } = data;
  if (status === "progress") {
    const { file, progress, loaded, total } = data;
    sendDownloadingMessage(file, progress, loaded, total); // Envía mensajes de progreso al hilo principal
  }
}

// Envía un mensaje indicando el estado de carga
function sendLoadingMessage(status) {
  self.postMessage({
    type: MessageTypes.LOADING,
    status,
  });
}

// Envía un mensaje con información sobre la descarga del modelo
async function sendDownloadingMessage(file, progress, loaded, total) {
  self.postMessage({
    type: MessageTypes.DOWNLOADING,
    file,
    progress,
    loaded,
    total,
  });
}

// Clase para gestionar el seguimiento del proceso de generación de transcripciones
class GenerationTracker {
  constructor(pipeline, stride_length_s) {
    this.pipeline = pipeline; // Referencia al modelo cargado
    this.stride_length_s = stride_length_s; // Solapamiento entre fragmentos
    this.chunks = []; // Almacena los fragmentos procesados
    this.time_precision =
      pipeline?.processor.feature_extractor.config.chunk_length /
      pipeline.model.config.max_source_positions; // Precisión temporal
    this.processed_chunks = []; // Resultados procesados
    this.callbackFunctionCounter = 0; // Contador para optimizar resultados parciales
  }

  // Envía un mensaje indicando que la transcripción ha finalizado
  sendFinalResult() {
    self.postMessage({ type: MessageTypes.INFERENCE_DONE });
  }

  // Callback para manejar resultados parciales del modelo
  callbackFunction(beams) {
    this.callbackFunctionCounter += 1;
    if (this.callbackFunctionCounter % 10 != 0) {
      return; // Optimiza para enviar solo algunos resultados parciales
    }

    const bestBeam = beams[0]; // Selecciona el mejor resultado parcial
    let text = this.pipeline.tokenizer.decode(bestBeam.output_token_ids, {
      skip_special_tokens: true, // Omite tokens especiales
    });

    const result = {
      text,
      start: this.getLastChunkTimestamp(),
      end: undefined,
    };

    createPartialResultMessage(result); // Envía el resultado parcial
  }

  // Callback para procesar fragmentos de audio
  chunkCallback(data) {
    this.chunks.push(data); // Agrega el fragmento procesado

    const [text, { chunks }] = this.pipeline.tokenizer._decode_asr(
      this.chunks,
      {
        time_precision: this.time_precision,
        return_timestamps: true,
        force_full_sequence: false,
      }
    );

    this.processed_chunks = chunks.map((chunk, index) => {
      return this.processChunk(chunk, index); // Procesa cada fragmento
    });

    createResultMessage(
      this.processed_chunks,
      false, // Indica que no es el resultado final
      this.getLastChunkTimestamp()
    );
  }

  // Obtiene la marca de tiempo del último fragmento procesado
  getLastChunkTimestamp() {
    if (this.processed_chunks.length === 0) {
      return 0;
    }
  }

  // Procesa un fragmento de texto con su marca de tiempo
  processChunk(chunk, index) {
    const { text, timestamp } = chunk;
    const [start, end] = timestamp;

    return {
      index,
      text: `${text.trim()}`,
      start: Math.round(start),
      end: Math.round(end) || Math.round(start + 0.9 * this.stride_length_s),
    };
  }
}

// Envía un mensaje con resultados finales o parciales
function createResultMessage(results, isDone, completedUntilTimestamp) {
  self.postMessage({
    type: MessageTypes.RESULT,
    results,
    isDone,
    completedUntilTimestamp,
  });
}

// Envía un mensaje con un resultado parcial
function createPartialResultMessage(result) {
  self.postMessage({
    type: MessageTypes.RESULT_PARTIAL,
    result,
  });
}
