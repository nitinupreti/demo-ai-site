/*
 * Sling Model for the steps component: heading + subheading + a row of numbered step cards.
 */
package com.demo.core.models;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class StepsModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String subheading;

    @ValueMapValue
    private String background;

    @ValueMapValue
    private String backgroundHex;

    @ChildResource
    private List<StepsItemModel> items;

    @PostConstruct
    protected void init() {
        if (items == null) {
            items = Collections.emptyList();
        } else {
            items = items.stream()
                    .filter(StepsItemModel::isHasContent)
                    .collect(Collectors.toList());
        }
    }

    public String getStyle() {
        return StringUtils.defaultIfBlank(style, "furniture");
    }

    public String getHeading() {
        return heading;
    }

    public String getSubheading() {
        return subheading;
    }

    public List<StepsItemModel> getItems() {
        return items;
    }

    public String getBackgroundStyle() {
        if ("other".equals(background) && StringUtils.isNotBlank(backgroundHex)) {
            String hex = backgroundHex.trim();
            if (!hex.startsWith("#")) {
                hex = "#" + hex;
            }
            return "background-color: " + hex + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading) || !items.isEmpty();
    }
}
