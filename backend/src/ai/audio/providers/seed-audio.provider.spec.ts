import { ConfigService } from '@nestjs/config';
// Stub the OssService module so importing the provider does not pull in ali-oss
// (an untransformed .ts inside node_modules that crashes ts-jest). We inject a
// hand-rolled mock at runtime anyway.
jest.mock('../../../oss/oss.service', () => ({ OssService: class {} }));
import { OssService } from '../../../oss/oss.service';
import { AudioGenerateDto } from '../audio-generate.dto';
import { SeedAudioProvider } from './seed-audio.provider';

describe('SeedAudioProvider', () => {
  const audioBytes = Buffer.from('FAKE_AUDIO_BYTES');
  let oss: { isEnabled: jest.Mock; putBuffer: jest.Mock };
  let config: ConfigService;
  let provider: SeedAudioProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    oss = {
      isEnabled: jest.fn().mockReturnValue(true),
      putBuffer: jest
        .fn()
        .mockResolvedValue({ key: 'projects/p1/audios/x.wav', url: 'https://oss.test/audios/x.wav' }),
    };
    config = {
      get: (key: string) =>
        ({
          NEW_API_BASE_URL: 'http://newapi.test',
          NEW_API_KEY: 'test-key',
        } as Record<string, string>)[key],
    } as unknown as ConfigService;

    provider = new SeedAudioProvider(config, oss as unknown as OssService);

    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength),
      text: async () => '',
      headers: new Headers({
        'X-NewApi-Consumed-Credits': '7',
        'X-NewApi-Audio-Duration': '3.50',
      }),
    });
    global.fetch = fetchMock;
  });

  it('posts to new-api, uploads bytes to OSS and surfaces consumedCredits', async () => {
    const dto: AudioGenerateDto = {
      mode: 'seed-audio',
      text: '你好，世界',
      voice: 'zh_female_x',
      format: 'wav',
      speechRate: 10,
      projectId: 'p1',
    } as AudioGenerateDto;

    const result = await provider.generate(dto, { projectId: 'p1' });

    // hit the right endpoint with Bearer auth + seed-audio model
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://newapi.test/v1/audio/speech');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('doubao-seed-audio-1-0');
    expect(body.input).toBe('你好，世界');
    expect(body.voice).toBe('zh_female_x');
    expect(body.response_format).toBe('wav');
    expect(body.speed).toBe(10);

    // uploaded the raw bytes to OSS under projects/{projectId}/audios/
    expect(oss.putBuffer).toHaveBeenCalledTimes(1);
    const [key, buf, contentType] = oss.putBuffer.mock.calls[0];
    expect(key).toMatch(/^projects\/p1\/audios\//);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.equals(audioBytes)).toBe(true);
    expect(contentType).toBe('audio/wav');

    // result shape + single-track billing bridge
    expect(result).toEqual({
      audioUrl: 'https://oss.test/audios/x.wav',
      durationSec: 3.5,
      mode: 'seed-audio',
      provider: 'volcengine',
      consumedCredits: 7,
    });
  });
});
