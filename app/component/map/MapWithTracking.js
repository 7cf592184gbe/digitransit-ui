import PropTypes from 'prop-types';
import React from 'react';
import cx from 'classnames'; // DT-3470
import connectToStores from 'fluxible-addons-react/connectToStores';
import onlyUpdateForKeys from 'recompose/onlyUpdateForKeys';
import getContext from 'recompose/getContext';
import LazilyLoad, { importLazy } from '../LazilyLoad';
import ComponentUsageExample from '../ComponentUsageExample';
import MapContainer from './MapContainer';
import ToggleMapTracking from '../ToggleMapTracking';
import { dtLocationShape } from '../../util/shapes';
import { isBrowser } from '../../util/browser';
import MapLayerStore, { mapLayerShape } from '../../store/MapLayerStore';
import PositionStore from '../../store/PositionStore';
import GeoJsonStore from '../../store/GeoJsonStore';
import MessageStore from '../../store/MessageStore';
import VehicleMarkerContainer from './VehicleMarkerContainer';
import {
  startRealTimeClient,
  stopRealTimeClient,
} from '../../action/realTimeClientAction';
import triggerMessage from '../../util/messageUtils';
import { addAnalyticsEvent } from '../../util/analyticsUtils';
import { getJson } from '../../util/xhrPromise';
import { getLabel } from '../../util/suggestionUtils';

const DEFAULT_ZOOM = 12;
const FOCUS_ZOOM = 16;

const onlyUpdateCoordChanges = onlyUpdateForKeys([
  'lat',
  'lon',
  'zoom',
  'mapTracking',
  'showStops',
  'showScaleBar',
  'origin',
  'children',
]);

const locationMarkerModules = {
  LocationMarker: () =>
    importLazy(import(/* webpackChunkName: "map" */ './LocationMarker')),
};

const polygonWithTextModules = {
  PolygonWithText: () =>
    importLazy(import(/* webpackChunkName: "map" */ './PolygonWithText')),
};

const jsonModules = {
  GeoJSON: () => importLazy(import(/* webpackChunkName: "map" */ './GeoJSON')),
};

const Component = onlyUpdateCoordChanges(MapContainer);

/* stop yet another eslint madness */
/* eslint-disable react/sort-comp */

const startClient = context => {
  const { realTime } = context.config;
  let agency;

  /* handle multiple feedid case */
  context.config.feedIds.forEach(ag => {
    if (!agency && realTime[ag]) {
      agency = ag;
    }
  });
  const source = agency && realTime[agency];
  if (source && source.active) {
    const config = {
      ...source,
      agency,
    };
    context.executeAction(startRealTimeClient, config);
  }
};

class MapWithTrackingStateHandler extends React.Component {
  static propTypes = {
    getGeoJsonConfig: PropTypes.func.isRequired,
    getGeoJsonData: PropTypes.func.isRequired,
    origin: dtLocationShape.isRequired,
    destination: dtLocationShape.isRequired,
    position: PropTypes.shape({
      hasLocation: PropTypes.bool.isRequired,
      isLocationingInProgress: PropTypes.bool.isRequired,
      lat: PropTypes.number.isRequired,
      lon: PropTypes.number.isRequired,
    }).isRequired,
    config: PropTypes.shape({
      defaultMapCenter: dtLocationShape,
      defaultEndpoint: dtLocationShape.isRequired,
      realTime: PropTypes.object.isRequired,
      feedIds: PropTypes.array.isRequired,
      showAllBusses: PropTypes.bool.isRequired,
      stopsMinZoom: PropTypes.number.isRequired,
      geoJson: PropTypes.shape({
        layers: PropTypes.array,
        layerConfigUrl: PropTypes.string,
      }),
    }).isRequired,
    children: PropTypes.array,
    renderCustomButtons: PropTypes.func,
    mapLayers: mapLayerShape.isRequired,
    messages: PropTypes.array,
    originFromMap: PropTypes.bool,
    destinationFromMap: PropTypes.bool,
    language: PropTypes.string,
  };

  static defaultProps = {
    renderCustomButtons: undefined,
    originFromMap: false,
    destinationFromMap: false,
  };

  constructor(props) {
    super(props);
    const hasOriginorPosition =
      props.origin.ready ||
      props.position.hasLocation ||
      props.destination.ready;
    this.state = {
      geoJson: {},
      initialZoom: hasOriginorPosition ? FOCUS_ZOOM : DEFAULT_ZOOM,
      mapTracking: props.origin.gps && props.position.hasLocation,
      focusOnOrigin: props.origin.ready,
      focusOnDestination: !props.origin.ready && props.destination.ready,
      origin: props.origin,
      destination: props.destination,
      shouldShowDefaultLocation: !hasOriginorPosition,
    };
  }

  async componentDidMount() {
    if (!isBrowser) {
      return;
    }
    const { config, getGeoJsonData, getGeoJsonConfig } = this.props;
    if (
      config.geoJson &&
      (Array.isArray(config.geoJson.layers) || config.geoJson.layerConfigUrl)
    ) {
      const layers = config.geoJson.layerConfigUrl
        ? await getGeoJsonConfig(config.geoJson.layerConfigUrl)
        : config.geoJson.layers;
      if (Array.isArray(layers) && layers.length > 0) {
        const json = await Promise.all(
          layers.map(async ({ url, name, isOffByDefault, metadata }) => ({
            url,
            isOffByDefault,
            data: await getGeoJsonData(url, name, metadata),
          })),
        );
        if (this.isCancelled) {
          return;
        }
        const { geoJson } = this.state;
        json.forEach(({ url, data, isOffByDefault }) => {
          geoJson[url] = { ...data, isOffByDefault };
        });
        this.setState(geoJson);
      }
    }

    if (this.state.focusOnOrigin || this.state.focusOnDestination) {
      const lat = this.state.focusOnDestination
        ? this.state.destination.lat
        : this.state.origin.lat;
      const lon = this.state.focusOnDestination
        ? this.state.destination.lon
        : this.state.origin.lon;
      await triggerMessage(lat, lon, this.context, this.props.messages);
    }
    if (this.props.mapLayers.showAllBusses) {
      startClient(this.context);
    }
  }

  // eslint-disable-next-line camelcase
  UNSAFE_componentWillReceiveProps(newProps) {
    if (
      // "current position selected"
      newProps.origin.lat !== null &&
      newProps.origin.lon !== null &&
      newProps.origin.gps === true &&
      ((this.state.origin.ready === false && newProps.origin.ready === true) ||
        !this.state.origin.gps) // current position selected
    ) {
      this.usePosition(newProps.origin);
      triggerMessage(
        newProps.origin.lat,
        newProps.origin.lon,
        this.context,
        this.props.messages,
      );
    } else if (
      // "current position selected"
      newProps.destination.lat !== null &&
      newProps.destination.lon !== null &&
      newProps.destination.gps === true &&
      ((this.state.destination.ready === false &&
        newProps.destination.ready === true) ||
        !this.state.destination.gps) // current position selected
    ) {
      this.usePosition(newProps.destination);
      triggerMessage(
        newProps.destination.lat,
        newProps.destination.lon,
        this.context,
        this.props.messages,
      );
    } else if (
      // "poi selected"
      !newProps.origin.gps &&
      (newProps.origin.lat !== this.state.origin.lat ||
        newProps.origin.lon !== this.state.origin.lon) &&
      newProps.origin.lat != null &&
      newProps.origin.lon != null
    ) {
      this.useOrigin(newProps.origin);
      triggerMessage(
        newProps.origin.lat,
        newProps.origin.lon,
        this.context,
        this.props.messages,
      );
    } else if (
      // destination selected without poi
      !newProps.destination.gps &&
      (newProps.destination.lat !== this.state.destination.lat ||
        newProps.destination.lon !== this.state.destination.lon) &&
      newProps.destination.lat != null &&
      newProps.destination.lon != null
    ) {
      this.useDestination(newProps.destination);
      triggerMessage(
        newProps.destination.lat,
        newProps.destination.lon,
        this.context,
        this.props.messages,
      );
    }
    if (newProps.mapLayers.showAllBusses) {
      if (!this.props.mapLayers.showAllBusses) {
        startClient(this.context);
      }
    } else if (this.props.mapLayers.showAllBusses) {
      const { client } = this.context.getStore('RealTimeInformationStore');
      if (client) {
        this.context.executeAction(stopRealTimeClient, client);
      }
    }
  }

  componentWillUnmount() {
    this.isCancelled = true;
    const { client } = this.context.getStore('RealTimeInformationStore');
    if (client) {
      this.context.executeAction(stopRealTimeClient, client);
    }
  }

  centerMapViewToWantedCoordinates = (coordinates, zoomLevel) => {
    if (!this.mapElement || !this.mapElement.leafletElement) {
      return;
    }

    const { leafletElement } = this.mapElement;
    if (coordinates) {
      const zoom = zoomLevel || leafletElement.getZoom();
      leafletElement.setView(coordinates, zoom, { animate: true });
    }
  };

  setMapElementRef = element => {
    if (element && this.mapElement !== element) {
      this.mapElement = element;
    }
  };

  enableMapTracking = () => {
    this.setState({
      mapTracking: true,
      focusOnOrigin: false,
      focusOnDestination: false,
    });
    addAnalyticsEvent({
      category: 'Map',
      action: 'ReCenterToMyGeolocation',
      name: null,
    });
  };

  disableMapTracking = () => {
    this.setState({
      mapTracking: false,
      focusOnOrigin: false,
      focusOnDestination: false,
    });
  };

  updateCurrentBounds = () => {
    const newBounds = this.mapElement.leafletElement.getBounds();
    const { bounds } = this.state;
    if (bounds && bounds.equals(newBounds)) {
      return;
    }
    this.setState({
      bounds: newBounds,
    });
  };

  usePosition(origin) {
    this.setState(prevState => ({
      origin,
      mapTracking: true,
      focusOnOrigin: false,
      focusOnDestination: false,
      initialZoom:
        prevState.initialZoom === DEFAULT_ZOOM ? FOCUS_ZOOM : undefined,
      shouldShowDefaultLocation: false,
    }));
  }

  useOrigin(origin) {
    this.setState(prevState => ({
      origin,
      mapTracking: false,
      focusOnOrigin: true,
      focusOnDestination: false,
      initialZoom:
        prevState.initialZoom === DEFAULT_ZOOM ? FOCUS_ZOOM : undefined,
      shouldShowDefaultLocation: false,
    }));
  }

  useDestination(destination) {
    this.setState(prevState => ({
      destination,
      mapTracking: false,
      focusOnOrigin: false,
      focusOnDestination: true,
      initialZoom:
        prevState.initialZoom === DEFAULT_ZOOM ? FOCUS_ZOOM : undefined,
      shouldShowDefaultLocation: false,
    }));
  }

  getMapLocation = () => {
    if (!this.mapElement || !this.mapElement.leafletElement) {
      return;
    }

    const centerOfMap = this.mapElement.leafletElement.getCenter();

    if (
      this.state.locationOfMapCenter &&
      this.state.locationOfMapCenter.lat === centerOfMap.lat &&
      this.state.locationOfMapCenter.lon === centerOfMap.lng
    ) {
      return;
    }

    getJson(this.context.config.URL.PELIAS_REVERSE_GEOCODER, {
      'point.lat': centerOfMap.lat,
      'point.lon': centerOfMap.lng,
      'boundary.circle.radius': 0.1, // 100m
      lang: this.props.language,
      size: 1,
      layers: 'address',
      zones: 1,
    }).then(
      data => {
        if (data.features != null && data.features.length > 0) {
          const match = data.features[0].properties;
          this.setState(prevState => ({
            locationOfMapCenter: {
              ...prevState.locationOfMapCenter,
              address: getLabel(match),
              position: {
                lat: centerOfMap.lat,
                lon: centerOfMap.lng,
              },
            },
          }));
        } else {
          this.setState(prevState => ({
            locationOfMapCenter: {
              ...prevState.locationOfMapCenter,
              address: 'Selected location',
              position: {
                lat: centerOfMap.lat,
                lon: centerOfMap.lng,
              },
            },
          }));
        }
      },
      () => {
        this.setState({
          locationOfMapCenter: {
            address: 'Selected location',
            position: {
              lat: centerOfMap.lat,
              lon: centerOfMap.lng,
            },
          },
        });
      },
    );
  };

  endDragging = () => {
    if (!this.mapElement || !this.mapElement.leafletElement) {
      return;
    }
    this.updateCurrentBounds();
    if (this.props.originFromMap || this.props.destinationFromMap) {
      this.getMapLocation();
    }
  };

  endZoom = () => {
    if (!this.mapElement || !this.mapElement.leafletElement) {
      return;
    }
    if (
      (this.props.originFromMap || this.props.destinationFromMap) &&
      this.state.locationOfMapCenter
    ) {
      this.centerMapViewToWantedCoordinates(
        this.state.locationOfMapCenter.position,
      );
    }
  };

  render() {
    const {
      position,
      origin,
      destination,
      config,
      children,
      renderCustomButtons,
      mapLayers,
      ...rest
    } = this.props;
    const { geoJson, locationOfMapCenter } = this.state;

    let location;
    if (
      this.state.focusOnOrigin &&
      !this.state.origin.gps &&
      this.state.origin.lat != null &&
      this.state.origin.lon != null
    ) {
      location = this.state.origin;
    } else if (this.state.mapTracking && position.hasLocation) {
      location = position;
    } else if (
      this.state.focusOnDestination &&
      !this.state.destination.gps &&
      this.state.destination.lat != null &&
      this.state.destination.lon != null
    ) {
      location = this.state.destination;
    } else if (this.state.shouldShowDefaultLocation) {
      location = config.defaultMapCenter || config.defaultEndpoint;
    }
    const leafletObjs = [];

    if (this.props.mapLayers.showAllBusses) {
      const currentZoom =
        this.mapElement && this.mapElement.leafletElement
          ? this.mapElement.leafletElement._zoom // eslint-disable-line no-underscore-dangle
          : this.state.initialZoom;
      const useLargeIcon = currentZoom >= this.props.config.stopsMinZoom;
      leafletObjs.push(
        <VehicleMarkerContainer
          key="vehicles"
          useLargeIcon={useLargeIcon}
          ignoreMode
        />,
      );
    }

    if (!this.props.originFromMap && origin && origin.ready === true) {
      leafletObjs.push(
        <LazilyLoad modules={locationMarkerModules} key="from">
          {({ LocationMarker }) => (
            <LocationMarker position={origin} type="from" />
          )}
        </LazilyLoad>,
      );
    }
    if (
      !this.props.destinationFromMap &&
      destination &&
      destination.ready === true
    ) {
      leafletObjs.push(
        <LazilyLoad modules={locationMarkerModules} key="to">
          {({ LocationMarker }) => (
            <LocationMarker position={destination} type="to" />
          )}
        </LazilyLoad>,
      );
    }
    let positionSelectingFromMap;

    if (this.props.originFromMap || this.props.destinationFromMap) {
      const defaultLocation = config.defaultMapCenter || config.defaultEndpoint;
      positionSelectingFromMap =
        locationOfMapCenter && locationOfMapCenter.position
          ? locationOfMapCenter.position
          : defaultLocation;
      const markerKeyOrType = this.props.originFromMap ? 'from' : 'to';
      leafletObjs.push(
        <LazilyLoad modules={locationMarkerModules} key={markerKeyOrType}>
          {({ LocationMarker }) => (
            <LocationMarker
              position={positionSelectingFromMap}
              type={markerKeyOrType}
            />
          )}
        </LazilyLoad>,
      );

      if (!locationOfMapCenter && positionSelectingFromMap) {
        leafletObjs.push(
          <LazilyLoad modules={polygonWithTextModules} key="moveMapInfo">
            {({ PolygonWithText }) => (
              <PolygonWithText
                position={positionSelectingFromMap}
                text="Valitse määränpää siirtämällä karttaa"
              />
            )}
          </LazilyLoad>,
        );
      }
      if (locationOfMapCenter && positionSelectingFromMap) {
        leafletObjs.push(
          <LazilyLoad modules={polygonWithTextModules} key="markerInfo">
            {({ PolygonWithText }) => (
              <PolygonWithText
                position={positionSelectingFromMap}
                text={locationOfMapCenter.address}
              />
            )}
          </LazilyLoad>,
        );
      }
    }

    if (geoJson) {
      const { bounds } = this.state;
      Object.keys(geoJson)
        .filter(
          key =>
            mapLayers.geoJson[key] !== false &&
            (mapLayers.geoJson[key] === true ||
              geoJson[key].isOffByDefault !== true),
        )
        .forEach(key => {
          leafletObjs.push(
            <LazilyLoad modules={jsonModules} key={key}>
              {({ GeoJSON }) => (
                <GeoJSON bounds={bounds} data={geoJson[key].data} />
              )}
            </LazilyLoad>,
          );
        });
    }

    let btnClassName = 'map-with-tracking-buttons'; // DT-3470
    if (this.context.config.map.showZoomControl) {
      btnClassName = cx(btnClassName, 'roomForZoomControl');
    }

    let latitudeOfComponent = null;
    if (
      !latitudeOfComponent &&
      !locationOfMapCenter &&
      positionSelectingFromMap
    ) {
      latitudeOfComponent = positionSelectingFromMap.lat;
    }
    if (!latitudeOfComponent && locationOfMapCenter) {
      latitudeOfComponent = locationOfMapCenter.lat;
    }
    if (!latitudeOfComponent && location) {
      latitudeOfComponent = location.lat;
    }

    let longitudeOfComponent = null;
    if (
      !longitudeOfComponent &&
      !locationOfMapCenter &&
      positionSelectingFromMap
    ) {
      longitudeOfComponent = positionSelectingFromMap.lon;
    }
    if (!longitudeOfComponent && locationOfMapCenter) {
      longitudeOfComponent = locationOfMapCenter.lng;
    }
    if (!longitudeOfComponent && location) {
      longitudeOfComponent = location.lon;
    }

    return (
      <Component
        lat={latitudeOfComponent}
        lon={longitudeOfComponent}
        zoom={
          this.props.originFromMap || this.props.destinationFromMap
            ? DEFAULT_ZOOM
            : this.state.initialZoom
        }
        mapTracking={this.state.mapTracking}
        className="flex-grow"
        origin={origin}
        destination={destination}
        leafletEvents={{
          onDragstart: this.disableMapTracking,
          onDragend: this.endDragging,
          onDrag:
            this.props.originFromMap || this.props.destinationFromMap
              ? this.getMapLocation
              : null,
          onZoomend:
            this.props.originFromMap || this.props.destinationFromMap
              ? this.endZoom
              : null,
        }}
        disableMapTracking={this.disableMapTracking}
        {...rest}
        leafletObjs={leafletObjs}
        mapRef={this.setMapElementRef}
      >
        {children}
        <div className={btnClassName}>
          {renderCustomButtons && renderCustomButtons()}
          {position.hasLocation && (
            <ToggleMapTracking
              key="toggleMapTracking"
              handleClick={
                this.state.mapTracking
                  ? this.disableMapTracking
                  : this.enableMapTracking
              }
              className={`icon-mapMarker-toggle-positioning-${
                this.state.mapTracking ? 'online' : 'offline'
              }`}
            />
          )}
        </div>
      </Component>
    );
  }
}

MapWithTrackingStateHandler.contextTypes = {
  executeAction: PropTypes.func,
  getStore: PropTypes.func,
  config: PropTypes.object,
};

// todo convert to use origin prop
const MapWithTracking = connectToStores(
  getContext({
    config: PropTypes.shape({
      defaultMapCenter: dtLocationShape,
    }),
  })(MapWithTrackingStateHandler),
  [PositionStore, MapLayerStore, GeoJsonStore, MessageStore],
  ({ getStore }) => {
    const position = getStore(PositionStore).getLocationState();
    const mapLayers = getStore(MapLayerStore).getMapLayers();
    const { getGeoJsonConfig, getGeoJsonData } = getStore(GeoJsonStore);
    const messages = getStore(MessageStore).getMessages();

    return { position, mapLayers, getGeoJsonConfig, getGeoJsonData, messages };
  },
);

MapWithTracking.description = (
  <div>
    <p>Renders a map with map-tracking functionality</p>
    <ComponentUsageExample description="">
      <MapWithTracking />
    </ComponentUsageExample>
  </div>
);

export { MapWithTracking as default, MapWithTrackingStateHandler as Component };
