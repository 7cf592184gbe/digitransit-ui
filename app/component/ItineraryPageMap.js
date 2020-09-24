import PropTypes from 'prop-types';
import React from 'react';
import get from 'lodash/get';
import { matchShape, routerShape } from 'found';
import LocationMarker from './map/LocationMarker';
import ItineraryLine from './map/ItineraryLine';
import MapContainer from './map/MapContainer';
import { otpToLocation } from '../util/otpStrings';
import { isBrowser } from '../util/browser';
import { dtLocationShape } from '../util/shapes';
import withBreakpoint from '../util/withBreakpoint';
import BackButton from './BackButton';
import VehicleMarkerContainer from './map/VehicleMarkerContainer'; // DT-3473

let L;

if (isBrowser) {
  // eslint-disable-next-line
  L = require('leaflet');
}

let timeout;

function ItineraryPageMap(
  { itinerary, center, breakpoint, bounds, streetMode },
  { match, config },
) {
  const { from, to } = match.params;

  const leafletObjs = [
    <LocationMarker
      key="fromMarker"
      position={otpToLocation(from)}
      type="from"
      streetMode={streetMode}
    />,
    <LocationMarker
      key="toMarker"
      position={otpToLocation(to)}
      type="to"
      streetMode={streetMode}
    />,
    <VehicleMarkerContainer key="vehicles" useLargeIcon />,
  ];
  if (match.location.query && match.location.query.intermediatePlaces) {
    if (Array.isArray(match.location.query.intermediatePlaces)) {
      match.location.query.intermediatePlaces
        .map(otpToLocation)
        .forEach((markerLocation, i) => {
          leafletObjs.push(
            <LocationMarker
              key={`via_${i}`} // eslint-disable-line react/no-array-index-key
              position={markerLocation}
            />,
          );
        });
    } else {
      leafletObjs.push(
        <LocationMarker
          key="via"
          position={otpToLocation(match.location.query.intermediatePlaces)}
        />,
      );
    }
  }

  if (itinerary) {
    leafletObjs.push(
      <ItineraryLine
        key="line"
        legs={itinerary.legs}
        showTransferLabels
        showIntermediateStops
        streetMode={streetMode}
      />,
    );
  }

  if (!center && itinerary && !itinerary.legs[0].transitLeg) {
    // bounds = polyline.decode(itinerary.legs[0].legGeometry.points);
  }

  const showScale = breakpoint === 'large';

  // onCenterMap() used to check if the layer has a marker for an itinerary
  // stop, emulate a click on the map to open up the popup
  const onCenterMap = element => {
    const map = get(element, 'leafletElement', null);
    if (!map || (!center && !bounds)) {
      return;
    }
    map.closePopup();
    clearTimeout(timeout);
    if (!bounds || (breakpoint === 'large' && !bounds)) {
      const latlngPoint = new L.LatLng(center.lat, center.lon);
      map.eachLayer(layer => {
        if (
          layer instanceof L.Marker &&
          layer.getLatLng().equals(latlngPoint)
        ) {
          timeout = setTimeout(
            () =>
              layer.fireEvent('click', {
                latlng: latlngPoint,
                layerPoint: map.latLngToLayerPoint(latlngPoint),
                containerPoint: map.latLngToContainerPoint(latlngPoint),
              }),
            250,
          );
          // Timout duration comes from
          // https://github.com/Leaflet/Leaflet/blob/v1.1.0/src/dom/PosAnimation.js#L35
        }
      });
    }
  };

  return (
    <MapContainer
      className="full itinerary"
      leafletObjs={leafletObjs}
      lat={center ? center.lat : from.lat}
      lon={center ? center.lon : from.lon}
      zoom={bounds ? undefined : 16}
      bounds={bounds}
      fitBounds={Boolean(bounds)}
      boundsOptions={{ maxZoom: 16 }}
      showScaleBar={showScale}
      mapRef={onCenterMap}
      hideOrigin
    >
      <BackButton
        icon="icon-icon_arrow-collapse--left"
        iconClassName="arrow-icon"
        color={config.colors.primary}
      />
    </MapContainer>
  );
}

ItineraryPageMap.propTypes = {
  itinerary: PropTypes.object,
  center: dtLocationShape,
  breakpoint: PropTypes.string.isRequired,
  bounds: PropTypes.array,
  streetMode: PropTypes.string,
};

ItineraryPageMap.contextTypes = {
  match: matchShape.isRequired,
  router: routerShape.isRequired,
  config: PropTypes.object,
};

export default withBreakpoint(ItineraryPageMap);
