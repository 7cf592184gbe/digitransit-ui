/* eslint-disable react/no-array-index-key */
/* eslint-disable no-nested-ternary */
import PropTypes from 'prop-types';
import moment from 'moment';
import React from 'react';
import {
  createRefetchContainer,
  fetchQuery,
  graphql,
  ReactRelayContext,
} from 'react-relay';
import { connectToStores } from 'fluxible-addons-react';
import { FormattedMessage, intlShape } from 'react-intl';
import { matchShape, routerShape } from 'found';
import isEqual from 'lodash/isEqual';
import isEmpty from 'lodash/isEmpty';
import polyline from 'polyline-encoded';
import DesktopView from './DesktopView';
import MobileView from './MobileView';
import ItineraryPageMap from './map/ItineraryPageMap';
import ItineraryListContainer from './ItineraryListContainer';
import { spinnerPosition } from './ItineraryList/ItineraryList';
import ItineraryPageControls from './ItineraryPageControls';
import MobileItineraryWrapper from './MobileItineraryWrapper';
import { getWeatherData } from '../util/apiUtils';
import Loading from './Loading';
import { getItineraryPagePath, streetHash } from '../util/path';
import { boundWithMinimumArea } from '../util/geo-utils';
import {
  planQuery,
  moreItinerariesQuery,
  walkAndBikeQuery,
  allModesQuery,
  viewerQuery,
} from './ItineraryQueries';
import {
  showDetailView,
  getSelectedItineraryIndex,
  reportError,
  addFeedbackly,
  getTopics,
  getBounds,
  compareItineraries,
  settingsLimitRouting,
  setCurrentTimeToURL,
  updateClient,
  stopClient,
  getRentalStationsToHideOnMap,
  addBikeStationMapForRentalVehicleItineraries,
  checkDayNight,
  filterItinerariesByFeedId,
  transitItineraries,
  filterItineraries,
} from './ItineraryPageUtils';
import withBreakpoint from '../util/withBreakpoint';
import { isIOS } from '../util/browser';
import { addAnalyticsEvent } from '../util/analyticsUtils';
import {
  parseLatLon,
  otpToLocation,
  getIntermediatePlaces,
} from '../util/otpStrings';
import { SettingsDrawer } from './SettingsDrawer';

import ItineraryDetails from './ItineraryDetails';
import { StreetModeSelector } from './StreetModeSelector';
import SwipeableTabs from './SwipeableTabs';
import {
  getCurrentSettings,
  preparePlanParams,
  hasStartAndDestination,
} from '../util/planParamUtil';
import { refShape, mapLayerOptionsShape } from '../util/shapes';
import { saveFutureRoute } from '../action/FutureRoutesActions';
import { saveSearch } from '../action/SearchActions';
import CustomizeSearch from './CustomizeSearchNew';
import { mapLayerShape } from '../store/MapLayerStore';
import { getMapLayerOptions } from '../util/mapLayerUtils';
import ItineraryShape from '../prop-types/ItineraryShape';
import ErrorShape from '../prop-types/ErrorShape';
import RoutingErrorShape from '../prop-types/RoutingErrorShape';

const streetHashes = [
  streetHash.walk,
  streetHash.bike,
  streetHash.bikeAndVehicle,
  streetHash.car,
  streetHash.parkAndRide,
];
const showVehiclesThresholdMinutes = 720;
const emptyPlans = {
  walkPlan: undefined,
  bikePlan: undefined,
  bikeTransitPlan: undefined,
  carPlan: undefined,
  parkRidePlan: undefined,
  earlierItineraries: [],
  laterItineraries: [],
  weatherData: undefined,
  separatorPosition: undefined,
  routingFeedbackPosition: undefined,
  relaxedPlan: undefined,
};

class ItineraryPage extends React.Component {
  static contextTypes = {
    config: PropTypes.object,
    executeAction: PropTypes.func.isRequired,
    headers: PropTypes.object.isRequired,
    getStore: PropTypes.func,
    router: routerShape.isRequired,
    match: matchShape.isRequired,
    intl: intlShape.isRequired,
  };

  static propTypes = {
    match: matchShape.isRequired,
    viewer: PropTypes.shape({
      plan: PropTypes.shape({
        routingErrors: PropTypes.arrayOf(RoutingErrorShape),
        itineraries: PropTypes.arrayOf(ItineraryShape),
      }),
    }).isRequired,
    serviceTimeRange: PropTypes.shape({
      start: PropTypes.number.isRequired,
      end: PropTypes.number.isRequired,
    }).isRequired,
    content: PropTypes.node,
    map: PropTypes.shape({
      type: PropTypes.func.isRequired,
    }),
    breakpoint: PropTypes.string.isRequired,
    error: ErrorShape,
    loading: PropTypes.bool,
    relayEnvironment: PropTypes.object.isRequired,
    relay: PropTypes.shape({
      refetch: PropTypes.func.isRequired,
    }).isRequired,
    mapLayers: mapLayerShape.isRequired,
    mapLayerOptions: mapLayerOptionsShape.isRequired,
    alertRef: refShape,
  };

  static defaultProps = {
    map: undefined,
    error: undefined,
    loading: false,
  };

  constructor(props, context) {
    super(props, context);
    this.expandMap = 0;

    this.tabHeaderRef = React.createRef(null);
    this.headerRef = React.createRef();
    this.contentRef = React.createRef();

    setCurrentTimeToURL(context.config, props.match);

    this.state = emptyPlans;
  }

  stopClientAndUpdateTopics() {
    stopClient(this.context);
    this.setState({ itineraryTopics: undefined });
  }

  selectStreetMode = newStreetMode => {
    const newLocationState = {
      ...this.props.match.location,
      state: { selectedItineraryIndex: 0 },
    };
    const basePath = getItineraryPagePath(
      this.props.match.params.from,
      this.props.match.params.to,
    );
    let pagePath = basePath;
    if (newStreetMode) {
      pagePath = `${pagePath}/${newStreetMode}`;
    }
    newLocationState.pathname = basePath;
    this.context.router.replace(newLocationState);
    newLocationState.pathname = pagePath;
    this.context.router.push(newLocationState);
  };

  setStreetModeAndSelect = newStreetMode => {
    addAnalyticsEvent({
      category: 'Itinerary',
      action: 'OpenItineraryDetailsWithMode',
      name: newStreetMode,
    });
    this.selectStreetMode(newStreetMode);
  };

  resetItineraryPageSelection = () => {
    this.context.router.replace({
      ...this.props.match.location,
      state: {
        ...this.props.match.location.state,
        selectedItineraryIndex: 0,
      },
    });
  };

  hasValidFromTo() {
    const { params } = this.props.match;
    return (
      hasStartAndDestination(params) &&
      (!isEqual(otpToLocation(params.from), otpToLocation(params.to)) ||
        getIntermediatePlaces(this.props.match.location.query).length)
    );
  }

  mapHashToPlan(hash) {
    switch (hash) {
      case streetHash.walk:
        return this.state.walkPlan;
      case streetHash.bike:
        return this.state.bikePlan;
      case streetHash.bikeAndVehicle:
        return this.state.bikeTransitPlan;
      case streetHash.car:
        return this.state.carPlan;
      case streetHash.parkAndRide:
        return this.state.parkRidePlan;
      default:
        if (
          transitItineraries(this.props.viewer?.plan?.itineraries).length ===
            0 &&
          !this.state.settingsChangedRecently &&
          this.state.relaxedPlan?.itineraries?.length > 0
        ) {
          return this.state.relaxedPlan;
        }
        return this.props.viewer.plan;
    }
  }

  makeAlternativeQuery() {
    if (!this.hasValidFromTo()) {
      return;
    }
    this.setState({ loadingAlt: true });

    const planParams = preparePlanParams(this.context.config, false)(
      this.props.match.params,
      this.props.match,
    );

    fetchQuery(this.props.relayEnvironment, walkAndBikeQuery, planParams)
      .toPromise()
      .then(result => {
        // filter plain walking / biking away
        const bikeParkItineraries = transitItineraries(
          result.bikeParkPlan?.itineraries,
        );
        const bikePublicItineraries = transitItineraries(
          result.bikeAndPublicPlan?.itineraries,
        );

        // show 6 bike + transit itineraries, preferably 3 of both kind.
        // If there is not enough of a kind, take more from the other kind
        let n1 = bikeParkItineraries.length;
        let n2 = bikePublicItineraries.length;
        if (n1 < 3) {
          n2 = Math.min(6 - n1, n2);
        } else if (n2 < 3) {
          n1 = Math.min(6 - n2, n1);
        } else {
          n1 = 3;
          n2 = 3;
        }
        this.bikeAndParkItineraryCount = n1;
        const bikeTransitPlan = {
          ...result.bikeParkPlan,
          itineraries: [
            ...bikeParkItineraries.slice(0, n1),
            ...bikePublicItineraries.slice(0, 3),
          ],
        };

        const bikePlan = {
          ...result.bikePlan,
          itineraries: filterItineraries(result.bikePlan?.itineraries, [
            'BICYCLE',
          ]),
        };

        this.setState(
          {
            loadingAlt: false,
            walkPlan: result.walkPlan,
            bikePlan,
            bikeTransitPlan,
            carPlan: result.carPlan,
            parkRidePlan: result.parkRidePlan,
          },
          () => {
            if (this.context.config.showWeatherInformation) {
              this.makeWeatherQuery();
            }
          },
        );
      })
      .catch(() => {
        this.setState({ loadingAlt: false });
      });
  }

  makeRelaxedQuery() {
    if (!this.hasValidFromTo()) {
      return;
    }
    this.setState({ loadingRelaxed: true });

    const planParams = preparePlanParams(this.context.config, true)(
      this.props.match.params,
      this.props.match,
    );
    fetchQuery(this.props.relayEnvironment, allModesQuery, planParams, {
      force: true,
    })
      .toPromise()
      .then(result => {
        const relaxedPlan = {
          ...result.plan,
          itineraries: transitItineraries(result.plan.itineraries),
        };
        this.setState({
          relaxedPlan,
          earlierItineraries: [],
          laterItineraries: [],
          separatorPosition: undefined,
          loadingRelaxed: false,
        });
      });
  }

  onLater = (itineraries, reversed) => {
    addAnalyticsEvent({
      event: 'sendMatomoEvent',
      category: 'Itinerary',
      action: 'ShowLaterItineraries',
      name: null,
    });
    const end = moment.unix(this.props.serviceTimeRange.end);
    const latestDepartureTime = itineraries.reduce((previous, current) => {
      const startTime = moment(current.startTime);

      if (previous == null) {
        return startTime;
      }
      if (startTime.isAfter(previous)) {
        return startTime;
      }
      return previous;
    }, null);

    latestDepartureTime.add(1, 'minutes');

    if (latestDepartureTime >= end) {
      // Departure time is going beyond available time range
      this.setError('no-route-end-date-not-in-range');
      return;
    }

    const useRelaxedRoutingPreferences =
      transitItineraries(this.props.viewer?.plan?.itineraries).length === 0 &&
      this.state.relaxedPlan?.itineraries?.length > 0;

    const params = preparePlanParams(
      this.context.config,
      useRelaxedRoutingPreferences,
    )(this.props.match.params, this.props.match);

    const tunedParams = {
      wheelchair: null,
      ...params,
      numItineraries: 5,
      arriveBy: false,
      date: latestDepartureTime.format('YYYY-MM-DD'),
      time: latestDepartureTime.format('HH:mm'),
    };

    this.setState({
      loadingMore: reversed ? spinnerPosition.top : spinnerPosition.bottom,
    });
    this.showScreenreaderLoadingAlert();

    fetchQuery(this.props.relayEnvironment, moreItinerariesQuery, tunedParams)
      .toPromise()
      .then(({ plan: result }) => {
        this.showScreenreaderLoadedAlert();
        if (reversed) {
          const reversedItineraries = result.itineraries
            .slice() // Need to copy because result is readonly
            .reverse()
            .filter(
              itinerary => !itinerary.legs.every(leg => leg.mode === 'WALK'),
            );
          // We need to filter only walk itineraries out to place the "separator" accurately between itineraries
          this.setState(prevState => {
            return {
              earlierItineraries: [
                ...reversedItineraries,
                ...prevState.earlierItineraries,
              ],
              loadingMore: undefined,
              separatorPosition: prevState.separatorPosition
                ? prevState.separatorPosition + reversedItineraries.length
                : reversedItineraries.length,
            };
          });
        } else {
          this.setState(prevState => {
            return {
              laterItineraries: [
                ...prevState.laterItineraries,
                ...result.itineraries,
              ],
              loadingMore: undefined,
              routingFeedbackPosition: prevState.routingFeedbackPosition
                ? prevState.routingFeedbackPosition + result.itineraries.length
                : result.itineraries.length,
            };
          });
        }
      });
  };

  onEarlier = (itineraries, reversed) => {
    addAnalyticsEvent({
      event: 'sendMatomoEvent',
      category: 'Itinerary',
      action: 'ShowEarlierItineraries',
      name: null,
    });

    const start = moment.unix(this.props.serviceTimeRange.start);
    const earliestArrivalTime = itineraries.reduce((previous, current) => {
      const endTime = moment(current.endTime);
      if (previous == null) {
        return endTime;
      }
      if (endTime.isBefore(previous)) {
        return endTime;
      }
      return previous;
    }, null);

    earliestArrivalTime.subtract(1, 'minutes');
    if (earliestArrivalTime <= start) {
      this.setError('no-route-start-date-too-early');
      return;
    }

    const useRelaxedRoutingPreferences =
      transitItineraries(this.props.viewer?.plan?.itineraries).length === 0 &&
      this.state.relaxedPlan?.itineraries?.length > 0;

    const params = preparePlanParams(
      this.context.config,
      useRelaxedRoutingPreferences,
    )(this.props.match.params, this.props.match);

    const tunedParams = {
      wheelchair: null,
      ...params,
      numItineraries: 5,
      arriveBy: true,
      date: earliestArrivalTime.format('YYYY-MM-DD'),
      time: earliestArrivalTime.format('HH:mm'),
    };
    this.setState({
      loadingMore: reversed ? spinnerPosition.bottom : spinnerPosition.top,
    });
    this.showScreenreaderLoadingAlert();

    fetchQuery(this.props.relayEnvironment, moreItinerariesQuery, tunedParams)
      .toPromise()
      .then(({ plan: result }) => {
        const newItineraries = transitItineraries(result.itineraries);
        if (newItineraries.length === 0) {
          // Could not find routes arriving at original departure time
          // --> cannot calculate earlier start time
          this.setError('no-route-start-date-too-early');
        }
        this.showScreenreaderLoadedAlert();
        if (reversed) {
          this.setState(prevState => {
            return {
              laterItineraries: [
                ...prevState.laterItineraries,
                ...newItineraries,
              ],
              loadingMore: undefined,
            };
          });
        } else {
          // Reverse the results so that route suggestions are in ascending order
          this.setState(prevState => {
            return {
              earlierItineraries: [
                ...newItineraries.reverse(),
                ...prevState.earlierItineraries,
              ],
              loadingMore: undefined,
              separatorPosition: prevState.separatorPosition
                ? prevState.separatorPosition + newItineraries.length
                : newItineraries.length,
              routingFeedbackPosition: prevState.routingFeedbackPosition
                ? prevState.routingFeedbackPosition
                : newItineraries.length,
            };
          });
          this.resetItineraryPageSelection();
        }
      });
  };

  // save url-defined location to old searches
  saveUrlSearch(endpoint) {
    const parts = endpoint.split('::'); // label::lat,lon
    if (parts.length !== 2) {
      return;
    }
    const label = parts[0];
    const ll = parseLatLon(parts[1]);
    const names = label.split(','); // addr or name, city
    if (names.length < 2 || Number.isNaN(ll.lat) || Number.isNaN(ll.lon)) {
      return;
    }
    const layer =
      /\d/.test(names[0]) && names[0].indexOf(' ') >= 0 ? 'address' : 'venue';

    this.context.executeAction(saveSearch, {
      item: {
        geometry: { coordinates: [ll.lon, ll.lat] },
        properties: {
          name: names[0],
          id: label,
          gid: label,
          layer,
          label,
          localadmin: names[names.length - 1],
        },
        type: 'Feature',
      },
      type: 'endpoint',
    });
  }

  updateLocalStorage(saveEndpoints) {
    const { location } = this.props.match;
    const { query } = location;
    const pathArray = decodeURIComponent(location.pathname)
      .substring(1)
      .split('/');
    // endpoints to oldSearches store
    if (saveEndpoints && isIOS && query.save) {
      if (query.save === '1' || query.save === '2') {
        this.saveUrlSearch(pathArray[1]); // origin
      }
      if (query.save === '1' || query.save === '3') {
        this.saveUrlSearch(pathArray[2]); // destination
      }
      const newLocation = { ...location };
      delete newLocation.query.save;
      this.context.router.replace(newLocation);
    }
    // update future routes, too
    const originArray = pathArray[1].split('::');
    const destinationArray = pathArray[2].split('::');
    // make sure endpoints are valid locations and time is defined
    if (!query.time || originArray.length < 2 || destinationArray.length < 2) {
      return;
    }
    const itinerarySearch = {
      origin: {
        address: originArray[0],
        ...parseLatLon(originArray[1]),
      },
      destination: {
        address: destinationArray[0],
        ...parseLatLon(destinationArray[1]),
      },
      query,
    };
    this.context.executeAction(saveFutureRoute, itinerarySearch);
  }

  componentDidMount() {
    this.updateLocalStorage(true);
    addFeedbackly(this.context);
    if (settingsLimitRouting(this.context.config)) {
      this.makeRelaxedQuery();
    }
  }

  componentWillUnmount() {
    if (this.showVehicles()) {
      stopClient(this.context);
    }
  }

  componentDidUpdate(prevProps) {
    const { state, props } = this;
    const { params } = this.props.match;
    const { hash } = params;
    const { config } = this.context;

    if (
      !isEqual(hash, prevProps.match.params.hash) ||
      !isEqual(params.secondHash, prevProps.match.params.secondHash)
    ) {
      this.navigateMap();
      this.setState({
        center: undefined,
        bounds: undefined,
      });
    }

    setCurrentTimeToURL(config, props.match);

    if (streetHashes.includes(hash)) {
      const viaPoints = getIntermediatePlaces(props.match.location.query);
      // Reset streetmode selection ...
      if (
        !isEqual(
          // if intermediate places change
          getIntermediatePlaces(prevProps.match.location.query),
          viaPoints,
        ) || // detail view has no itineraries to show
        (!state.loadingAlt && !this.mapHashToPlan(hash)?.itineraries?.length)
      ) {
        this.selectStreetMode(); // back to root view
      }
    }

    // update stored future searches
    if (
      props.match.location.pathname !== prevProps.match.location.pathname ||
      props.match.location.query !== prevProps.match.location.query
    ) {
      this.updateLocalStorage(false);
    }

    const itinerariesChanged = props.viewer.plan !== this.plan;
    if (itinerariesChanged) {
      this.plan = props.viewer.plan;
      this.showScreenreaderLoadedAlert();
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState(emptyPlans, () => {
        if (settingsLimitRouting(config)) {
          this.makeRelaxedQuery();
        }
        this.makeAlternativeQuery();
      });
    }

    if (props.error) {
      reportError(props.error);
    }

    if (this.showVehicles()) {
      const combinedItineraries = transitItineraries(
        this.getCombinedItineraries(),
      );
      const itineraryTopics = getTopics(
        config,
        combinedItineraries,
        props.match,
      );
      const { client } = this.context.getStore('RealTimeInformationStore');
      // Client may not be initialized yet if there was an client before ComponentDidMount
      if (!isEqual(itineraryTopics, state.itineraryTopics) || !client) {
        updateClient(itineraryTopics, this.context);
      }
      if (!isEqual(itineraryTopics, state.itineraryTopics)) {
        // eslint-disable-next-line react/no-did-update-set-state
        this.setState({ itineraryTopics });
      }
    } else if (!isEmpty(state.itineraryTopics)) {
      this.stopClientAndUpdateTopics();
    }
  }

  setError(error) {
    reportError(error);
    this.setState({ error });
  }

  setMWTRef = ref => {
    this.mwtRef = ref;
  };

  // make the map to obey external navigation
  navigateMap() {
    // map sticks to user location if tracking is on, so set it off
    if (this.mwtRef?.disableMapTracking) {
      this.mwtRef.disableMapTracking();
    }
    // map will not react to location props unless they change or update is forced
    if (this.mwtRef?.forceRefresh) {
      this.mwtRef.forceRefresh();
    }
  }

  focusToPoint = (lat, lon) => {
    if (this.props.breakpoint !== 'large') {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      this.expandMap += 1;
    }
    this.navigateMap();
    this.setState({ center: { lat, lon }, bounds: null });
  };

  focusToLeg = leg => {
    if (this.props.breakpoint !== 'large') {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      this.expandMap += 1;
    }
    this.navigateMap();
    const bounds = boundWithMinimumArea(
      []
        .concat(
          [
            [leg.from.lat, leg.from.lon],
            [leg.to.lat, leg.to.lon],
          ],
          polyline.decode(leg.legGeometry.points),
        )
        .filter(a => a[0] && a[1]),
    );
    this.setState({
      bounds,
      center: undefined,
    });
  };

  makeWeatherQuery() {
    const from = otpToLocation(this.props.match.params.from);
    const { walkPlan, bikePlan, bikeTransitPlan } = this.state;
    const itinerary =
      walkPlan?.itineraries?.[0] ||
      bikePlan?.itineraries?.[0] ||
      bikeTransitPlan?.itineraries?.[0];
    if (!itinerary) {
      return;
    }
    const time = itinerary.startTime;
    const weatherHash = `${time}_${from.lat}_${from.lon}`;
    if (
      weatherHash !== this.state.weatherData?.weatherHash &&
      weatherHash !== this.pendingWeatherHash
    ) {
      this.pendingWeatherHash = weatherHash;
      const momentTime = moment(time);
      this.setState({ loadingWeather: true });
      getWeatherData(
        this.context.config.URL.WEATHER_DATA,
        momentTime,
        from.lat,
        from.lon,
      )
        .then(res => {
          if (weatherHash === this.pendingWeatherHash) {
            // no cascading fetches
            this.pendingWeatherHash = undefined;
            let weatherData;
            if (Array.isArray(res) && res.length === 3) {
              const temperature = Number(res[0].ParameterValue);
              const windSpeed = Number(res[1].ParameterValue);
              const iconIndex = parseInt(res[2].ParameterValue, 10);

              if (
                !Number.isNaN(temperature) &&
                !Number.isNaN(windSpeed) &&
                !Number.isNaN(iconIndex)
              ) {
                weatherData = {
                  weatherHash,
                  time,
                  temperature,
                  windSpeed,
                  // Icon spec: www.ilmatieteenlaitos.fi/latauspalvelun-pikaohje -> Sääsymbolien selitykset ennusteissa
                  iconId: checkDayNight(
                    iconIndex,
                    momentTime,
                    from.lat,
                    from.lon,
                  ),
                };
              }
            }
            this.setState({ loadingWeather: false, weatherData });
          }
        })
        .catch(() => {
          this.pendingWeatherHash = undefined;
          this.setState({ loadingWeather: false, weatherData: undefined });
        })
        .finally(() => {
          if (this.props.alertRef.current) {
            this.props.alertRef.current.innerHTML =
              this.context.intl.formatMessage({
                id: 'itinerary-summary-page-street-mode.update-alert',
                defaultMessage: 'Walking and biking results updated',
              });
            setTimeout(() => {
              this.props.alertRef.current.innerHTML = null;
            }, 100);
          }
        });
    }
  }

  showScreenreaderLoadedAlert() {
    if (this.props.alertRef?.current?.innerHTML) {
      this.props.alertRef.current.innerHTML = null;
      this.props.alertRef.current.innerHTML = this.context.intl.formatMessage({
        id: 'itinerary-page.itineraries-loaded',
        defaultMessage: 'More itineraries loaded',
      });
      setTimeout(() => {
        if (this.props.alertRef?.current?.innerHTML) {
          this.props.alertRef.current.innerHTML = null;
        }
      }, 100);
    }
  }

  showScreenreaderUpdatedAlert() {
    if (this.props.alertRef.current) {
      if (this.props.alertRef.current.innerHTML) {
        this.props.alertRef.current.innerHTML = null;
      }
      this.props.alertRef.current.innerHTML = this.context.intl.formatMessage({
        id: 'itinerary-page.itineraries-updated',
        defaultMessage: 'search results updated',
      });
      setTimeout(() => {
        this.props.alertRef.current.innerHTML = null;
      }, 100);
    }
  }

  showScreenreaderLoadingAlert() {
    if (this.props.alertRef.current && !this.props.alertRef.current.innerHTML) {
      this.props.alertRef.current.innerHTML = this.context.intl.formatMessage({
        id: 'itinerary-page.loading-itineraries',
        defaultMessage: 'Loading for more itineraries',
      });
      setTimeout(() => {
        this.props.alertRef.current.innerHTML = null;
      }, 100);
    }
  }

  changeHash = index => {
    const { hash } = this.props.match.params;
    const subPath = [
      streetHash.bikeAndVehicle,
      streetHash.parkAndRide,
    ].includes(hash)
      ? `/${hash}`
      : '';

    addAnalyticsEvent({
      event: 'sendMatomoEvent',
      category: 'Itinerary',
      action: 'OpenItineraryDetails',
      name: index,
    });

    const newLocationState = {
      ...this.props.match.location,
      state: { selectedItineraryIndex: index },
    };
    const pagePath = `${getItineraryPagePath(
      this.props.match.params.from,
      this.props.match.params.to,
    )}${subPath}/${index}`;

    newLocationState.pathname = pagePath;
    this.context.router.replace(newLocationState);
  };

  renderMap(from, to, viaPoints, itineraries, activeIndex, detailView) {
    const mwtProps = {};
    if (this.state.bounds) {
      mwtProps.bounds = this.state.bounds;
    } else if (this.state.center) {
      mwtProps.lat = this.state.center.lat;
      mwtProps.lon = this.state.center.lon;
    } else {
      mwtProps.bounds = getBounds(itineraries, from, to, viaPoints);
    }

    const itineraryContainsDepartureFromVehicleRentalStation = itineraries[
      activeIndex
    ]?.legs.some(leg => leg.from?.vehicleRentalStation);

    const mapLayerOptions = itineraryContainsDepartureFromVehicleRentalStation
      ? addBikeStationMapForRentalVehicleItineraries(itineraries)
      : this.props.mapLayerOptions;

    const objectsToHide = getRentalStationsToHideOnMap(
      itineraryContainsDepartureFromVehicleRentalStation,
      itineraries[activeIndex],
    );
    return (
      <ItineraryPageMap
        {...mwtProps}
        from={from}
        to={to}
        viaPoints={viaPoints}
        mapLayers={this.props.mapLayers}
        mapLayerOptions={mapLayerOptions}
        setMWTRef={this.setMWTRef}
        breakpoint={this.props.breakpoint}
        itineraries={itineraries}
        topics={this.state.itineraryTopics}
        active={activeIndex}
        showActive={detailView}
        showVehicles={this.showVehicles()}
        showDurationBubble={itineraries[0]?.legs?.length === 1}
        objectsToHide={objectsToHide}
      />
    );
  }

  toggleSearchSettings = () => {
    this.showSettingsPanel(!this.state.settingsOpen);
  };

  showSettingsPanel(isOpen) {
    if (this.headerRef.current && this.contentRef.current) {
      setTimeout(() => {
        let inputs = Array.from(
          this.headerRef?.current?.querySelectorAll(
            'input, button, *[role="button"]',
          ) || [],
        );
        inputs = inputs.concat(
          Array.from(
            this.contentRef?.current?.querySelectorAll(
              'input, button, *[role="button"]',
            ) || [],
          ),
        );
        /* eslint-disable no-param-reassign */
        if (isOpen) {
          // hide inputs from screen reader
          inputs.forEach(elem => {
            elem.tabIndex = '-1';
          });
        } else {
          // show inputs
          inputs.forEach(elem => {
            elem.tabIndex = '0';
          });
        }
        /* eslint-enable no-param-reassign */
      }, 100);
    }
    addAnalyticsEvent({
      event: 'sendMatomoEvent',
      category: 'ItinerarySettings',
      action: 'ExtraSettingsPanelClick',
      name: isOpen ? 'ExtraSettingsPanelOpen' : 'ExtraSettingsPanelClose',
    });

    if (isOpen) {
      this.setState({
        settingsOpen: true,
        settingsOnOpen: getCurrentSettings(this.context.config, ''),
      });
      if (this.props.breakpoint !== 'large') {
        this.context.router.push({
          ...this.props.match.location,
          state: {
            ...this.props.match.location.state,
            customizeSearchOffcanvas: isOpen,
          },
        });
      }
      return;
    }

    this.setState({ settingsOpen: false });
    if (this.props.breakpoint !== 'large') {
      this.context.router.go(-1);
    }
    const settingsChanged = !isEqual(
      this.state.settingsOnOpen,
      getCurrentSettings(this.context.config, ''),
    );
    if (!settingsChanged || !this.hasValidFromTo()) {
      return;
    }

    const planParams = preparePlanParams(this.context.config, false)(
      this.props.match.params,
      this.props.match,
    );
    this.setState(
      {
        earlierItineraries: [],
        laterItineraries: [],
        separatorPosition: undefined,
        relaxedPlan: undefined,
        settingsChangedRecently: true,
      },
      () => {
        this.props.relay.refetch(planParams, null, () => {
          this.makeAlternativeQuery();
          this.showScreenreaderUpdatedAlert();
          this.resetItineraryPageSelection();
        });
      },
    );
  }

  showVehicles() {
    const now = moment();
    const startTime = moment.unix(this.props.match.location.query.time);
    const diff = now.diff(startTime, 'minutes');
    const { hash } = this.props.match.params;

    // Vehicles are typically not shown if they are not in transit. But for some quirk in mqtt, if you
    // search for a route for example tomorrow, real time vehicle would be shown.
    this.inRange =
      (diff <= showVehiclesThresholdMinutes && diff >= 0) ||
      (diff >= -1 * showVehiclesThresholdMinutes && diff <= 0);

    return !!(
      this.inRange &&
      this.context.config.showVehiclesOnItineraryPage &&
      hash !== streetHash.walk &&
      hash !== streetHash.bike &&
      hash !== streetHash.car &&
      (this.props.breakpoint === 'large' || hash)
    );
  }

  getCombinedItineraries() {
    return [
      ...(this.state.earlierItineraries || []),
      ...(this.selectedPlan?.itineraries || []),
      ...(this.state.laterItineraries || []),
    ];
  }

  onDetailsTabFocused = () => {
    setTimeout(() => {
      if (this.tabHeaderRef.current) {
        this.tabHeaderRef.current.focus();
      }
    }, 500);
  };

  render() {
    const { props, context, state } = this;
    const { match, error, breakpoint } = props;
    const { walkPlan, bikePlan, bikeTransitPlan, carPlan, parkRidePlan } =
      state;
    const { config } = context;
    const { params } = match;
    const { hash } = params;

    const hasNoTransitItineraries =
      transitItineraries(props.viewer?.plan?.itineraries).length === 0;

    const settings = getCurrentSettings(config, '');

    this.selectedPlan = this.mapHashToPlan(hash);

    /* NOTE: as a temporary solution, do filtering by feedId in UI */
    if (config.feedIdFiltering && this.selectedPlan === props.viewer?.plan) {
      this.selectedPlan = filterItinerariesByFeedId(props.viewer?.plan, config);
    }

    if (
      props.loading ||
      (streetHashes.includes(hash) && state.loadingAlt) ||
      !this.selectedPlan
    ) {
      return <Loading />;
    }

    const showStreetModeSelector =
      (state.loadingAlt || // show shimmer
        walkPlan?.itineraries?.length ||
        bikePlan?.itineraries?.length ||
        bikeTransitPlan?.itineraries?.length ||
        parkRidePlan?.itineraries?.length ||
        (settings.includeCarSuggestions && carPlan?.itineraries?.length)) &&
      !hash; // not on bike + public or p&r views

    let combinedItineraries;
    // Remove old itineraries if new query cannot find a route
    if (error) {
      combinedItineraries = [];
    } else if (streetHashes.includes(hash)) {
      combinedItineraries = this.selectedPlan?.itineraries || [];
    } else {
      combinedItineraries = this.getCombinedItineraries();
      if (!hasNoTransitItineraries) {
        // don't show plain walking in transit itinerary list
        combinedItineraries = transitItineraries(combinedItineraries);
      }
    }

    const detailView = showDetailView(
      match.params.hash,
      match.params.secondHash,
      combinedItineraries,
    );
    const selectedIndex = getSelectedItineraryIndex(
      match.location,
      combinedItineraries,
    );
    const from = otpToLocation(params.from);
    const to = otpToLocation(params.to);
    const viaPoints = getIntermediatePlaces(match.location.query);

    const hasItineraries = combinedItineraries.length > 0;
    if (hasItineraries && match.routes.some(route => route.printPage)) {
      return React.cloneElement(props.content, {
        itinerary: combinedItineraries[selectedIndex],
        focusToPoint: this.focusToPoint,
        from,
        to,
      });
    }

    // no map on mobile summary view
    const map =
      !detailView && breakpoint !== 'large'
        ? null
        : this.renderMap(
            from,
            to,
            viaPoints,
            combinedItineraries,
            selectedIndex,
            detailView,
          );

    const loading =
      (state.loadingRelaxed && hasNoTransitItineraries) ||
      (!error && props.loading);

    const showRelaxedPlanNotifier = this.selectedPlan === state.relaxedPlan;
    const settingsNotification =
      !showRelaxedPlanNotifier && // show only on notifier about limitations
      settingsLimitRouting(this.context.config) &&
      compareItineraries(
        props.viewer?.plan?.itineraries,
        state.relaxedPlan?.itineraries,
      ) &&
      state.relaxedPlan?.itineraries?.length > 0 &&
      !hash; // no notifier on p&r or bike&public lists

    const itineraryListProps = {
      activeIndex: selectedIndex,
      plan: this.selectedPlan,
      routingErrors: this.selectedPlan.routingErrors,
      itineraries: combinedItineraries,
      params,
      error: error || state.error,
      walking: walkPlan?.itineraries?.length > 0,
      biking: bikePlan?.itineraries?.length > 0,
      driving:
        settings.includeCarSuggestions &&
        (carPlan?.itineraries?.length > 0 ||
          parkRidePlan?.itineraries?.length > 0),
      bikeAndParkItineraryCount: this.bikeAndParkItineraryCount,
      showRelaxedPlanNotifier,
      separatorPosition: state.separatorPosition,
      onLater: this.onLater,
      onEarlier: this.onEarlier,
      onDetailsTabFocused: this.onDetailsTabFocused,
      loading,
      loadingMore: state.loadingMore, // spinner pos while loading earlier/later
      settingsNotification,
      routingFeedbackPosition: state.routingFeedbackPosition,
    };

    const streetModeSelectorProps = {
      selectStreetMode: this.selectStreetMode,
      setStreetModeAndSelect: this.setStreetModeAndSelect,
      weatherData: state.weatherData,
      walkPlan,
      bikePlan,
      bikeTransitPlan,
      parkRidePlan,
      carPlan: settings.includeCarSuggestions ? carPlan : undefined,
      loading: loading || state.loadingAlt || state.loadingWeather,
    };

    let content;
    if (breakpoint === 'large') {
      /* Should render content if
      1. Fetching public itineraries is complete
      2. Don't have to wait for alternative query to complete
      Otherwise render spinner */

      // must wait alternatives to render correct notifier
      const waitAlternatives = hasNoTransitItineraries && state.loadingAlt;

      if (!loading && !waitAlternatives) {
        const selectedItinerary = combinedItineraries.length
          ? combinedItineraries[selectedIndex]
          : undefined;
        if (detailView && combinedItineraries.length) {
          const currentTime = {
            date: moment().valueOf(),
          };

          const itineraryTabs = combinedItineraries.map((itinerary, i) => {
            return (
              <div
                className={`swipeable-tab ${selectedIndex !== i && 'inactive'}`}
                key={`itinerary-${i}`}
                aria-hidden={selectedIndex !== i}
              >
                <ItineraryDetails
                  hideTitle
                  plan={currentTime}
                  itinerary={itinerary}
                  focusToPoint={this.focusToPoint}
                  focusToLeg={this.focusToLeg}
                  isMobile={false}
                  carItinerary={carPlan?.itineraries[0]}
                />
              </div>
            );
          });

          content = (
            <div className="swipe-scroll-wrapper">
              <SwipeableTabs
                tabs={itineraryTabs}
                tabIndex={selectedIndex}
                onSwipe={this.changeHash}
                classname="swipe-desktop-view"
                ariaFrom="swipe-summary-page"
                ariaFromHeader="swipe-summary-page-header"
              />
            </div>
          );
          return (
            <DesktopView
              title={
                <span ref={this.tabHeaderRef} tabIndex={-1}>
                  <FormattedMessage
                    id="itinerary-page.title"
                    defaultMessage="Itinerary suggestions"
                  />
                </span>
              }
              content={content}
              map={map}
              bckBtnVisible
              bckBtnFallback="pop"
            />
          );
        }
        content = (
          <ItineraryListContainer {...itineraryListProps}>
            {props.content &&
              React.cloneElement(props.content, {
                itinerary: selectedItinerary,
                focusToPoint: this.focusToPoint,
                plan: this.selectedPlan,
              })}
          </ItineraryListContainer>
        );
      } else {
        content = (
          <div style={{ position: 'relative', height: 200 }}>
            <Loading />
          </div>
        );
        return detailView ? (
          <DesktopView
            title={
              <FormattedMessage
                id="itinerary-page.title"
                defaultMessage="Itinerary suggestions"
              />
            }
            content={content}
            map={map}
            scrollable
            bckBtnVisible={false}
          />
        ) : (
          <DesktopView
            title={
              <FormattedMessage
                id="summary-page.title"
                defaultMessage="Itinerary suggestions"
              />
            }
            header={
              <React.Fragment>
                <ItineraryPageControls
                  params={params}
                  toggleSettings={this.toggleSearchSettings}
                />
                <StreetModeSelector {...streetModeSelectorProps} />
              </React.Fragment>
            }
            content={content}
            map={map}
          />
        );
      }
      return (
        <DesktopView
          title={
            <FormattedMessage
              id="summary-page.title"
              defaultMessage="Itinerary suggestions"
            />
          }
          bckBtnFallback={
            hash === streetHash.bikeAndVehicle ? 'pop' : undefined
          }
          header={
            <span aria-hidden={this.state.settingsOpen} ref={this.headerRef}>
              <ItineraryPageControls
                params={params}
                toggleSettings={this.toggleSearchSettings}
              />
              {error || !showStreetModeSelector ? null : (
                <StreetModeSelector {...streetModeSelectorProps} />
              )}
              {hash === streetHash.parkAndRide && (
                <div className="street-mode-info">
                  <FormattedMessage
                    id="leave-your-car-park-and-ride"
                    defaultMessage="Park your car at the Park & Ride site"
                  />
                </div>
              )}
            </span>
          }
          content={
            <span aria-hidden={this.state.settingsOpen} ref={this.contentRef}>
              {content}
            </span>
          }
          settingsDrawer={
            <SettingsDrawer
              open={this.state.settingsOpen}
              className="offcanvas"
            >
              <CustomizeSearch onToggleClick={this.toggleSearchSettings} />
            </SettingsDrawer>
          }
          map={map}
          scrollable
        />
      );
    }
    if (detailView) {
      if (loading) {
        return (
          <div style={{ position: 'relative', height: 200 }}>
            <Loading />
          </div>
        );
      }
      content = (
        <MobileItineraryWrapper
          itineraries={combinedItineraries}
          params={params}
          focusToPoint={this.focusToPoint}
          plan={this.selectedPlan}
          serviceTimeRange={props.serviceTimeRange}
          focusToLeg={this.focusToLeg}
          onSwipe={this.changeHash}
          carItinerary={carPlan?.itineraries[0]}
          changeHash={this.changeHash}
        >
          {props.content &&
            combinedItineraries.map((itinerary, i) =>
              React.cloneElement(props.content, {
                key: i,
                itinerary,
                plan: this.selectedPlan,
                serviceTimeRange: props.serviceTimeRange,
              }),
            )}
        </MobileItineraryWrapper>
      );
    } else if (loading) {
      content = (
        <div style={{ position: 'relative', height: 200 }}>
          <Loading />
        </div>
      );
    } else {
      content = <ItineraryListContainer {...itineraryListProps} />;
    }

    return (
      <MobileView
        header={
          !detailView ? (
            <span aria-hidden={this.state.settingsOpen} ref={this.headerRef}>
              <ItineraryPageControls
                params={params}
                toggleSettings={this.toggleSearchSettings}
              />
              {error || !showStreetModeSelector ? null : (
                <StreetModeSelector {...streetModeSelectorProps} />
              )}
              {hash === streetHash.parkAndRide && (
                <div className="street-mode-info">
                  <FormattedMessage
                    id="leave-your-car-park-and-ride"
                    defaultMessage="Park your car at the Park & Ride site"
                  />
                </div>
              )}
            </span>
          ) : (
            false
          )
        }
        content={
          <span aria-hidden={this.state.settingsOpen} ref={this.contentRef}>
            {content}
          </span>
        }
        map={map}
        settingsDrawer={
          <SettingsDrawer
            open={this.state.settingsOpen}
            className="offcanvas-mobile"
          >
            <CustomizeSearch onToggleClick={this.toggleSearchSettings} mobile />
          </SettingsDrawer>
        }
        expandMap={this.expandMap}
      />
    );
  }
}

const ItineraryPageWithBreakpoint = withBreakpoint(props => (
  <ReactRelayContext.Consumer>
    {({ environment }) => (
      <ItineraryPage {...props} relayEnvironment={environment} />
    )}
  </ReactRelayContext.Consumer>
));

const ItineraryPageWithStores = connectToStores(
  ItineraryPageWithBreakpoint,
  ['MapLayerStore'],
  ({ getStore }) => ({
    mapLayers: getStore('MapLayerStore').getMapLayers({
      notThese: ['stop', 'citybike', 'vehicles'],
    }),
    mapLayerOptions: getMapLayerOptions({
      lockedMapLayers: ['vehicles', 'citybike', 'stop'],
      selectedMapLayers: ['vehicles'],
    }),
  }),
);

const containerComponent = createRefetchContainer(
  ItineraryPageWithStores,
  {
    viewer: viewerQuery,
    serviceTimeRange: graphql`
      fragment ItineraryPage_serviceTimeRange on serviceTimeRange {
        start
        end
      }
    `,
  },
  planQuery,
);

export {
  containerComponent as default,
  ItineraryPageWithBreakpoint as Component,
};
