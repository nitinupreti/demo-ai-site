/*
 * Sling Model for the rating-strip component: 3-column feature strip
 * (icon + title + short description).
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
public class RatingStripModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String background;

    @ValueMapValue
    private String backgroundHex;

    @ChildResource
    private List<RatingStripItemModel> items;

    @PostConstruct
    protected void init() {
        if (items == null) {
            items = Collections.emptyList();
        } else {
            items = items.stream()
                    .filter(RatingStripItemModel::isHasContent)
                    .collect(Collectors.toList());
        }
    }

    public String getStyle() {
        return StringUtils.defaultIfBlank(style, "furniture");
    }

    public List<RatingStripItemModel> getItems() {
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
        return !items.isEmpty();
    }
}
