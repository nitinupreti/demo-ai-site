/*
 * Sling Model for the portfolio component: centered heading + subhead + row of category cards.
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
public class PortfolioModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String subheading;

    @ChildResource
    private List<PortfolioItemModel> items;

    @PostConstruct
    protected void init() {
        if (items == null) {
            items = Collections.emptyList();
        } else {
            items = items.stream().filter(PortfolioItemModel::isHasContent).collect(Collectors.toList());
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

    public List<PortfolioItemModel> getItems() {
        return items;
    }

    public String getBackgroundStyle() {
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading) || StringUtils.isNotBlank(subheading) || !items.isEmpty();
    }
}
