import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { App } from './app';
import { LastfmService } from './services/lastfm.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        // Stub the service so the component's polling never hits the network.
        { provide: LastfmService, useValue: { getNowPlaying: () => of(null) } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the Now Playing heading', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Now Playing');
  });
});
